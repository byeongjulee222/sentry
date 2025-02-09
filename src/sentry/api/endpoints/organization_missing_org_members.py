from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from email.headerregistry import Address
from functools import reduce
from typing import Dict, Sequence

from django.db.models import Count, Q, QuerySet
from django.utils import timezone
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response

from sentry import roles
from sentry.api.api_publish_status import ApiPublishStatus
from sentry.api.base import region_silo_endpoint
from sentry.api.bases.organization import OrganizationEndpoint, OrganizationPermission
from sentry.api.serializers import Serializer, serialize
from sentry.constants import ObjectStatus
from sentry.integrations.base import IntegrationFeatures
from sentry.models import Repository
from sentry.models.commitauthor import CommitAuthor
from sentry.models.organization import Organization
from sentry.search.utils import tokenize_query
from sentry.services.hybrid_cloud.integration import integration_service


class MissingOrgMemberSerializer(Serializer):
    def serialize(self, obj, attrs, user, **kwargs):
        return {"email": obj.email, "externalId": obj.external_id, "commitCount": obj.commit_count}


class MissingMembersPermission(OrganizationPermission):
    scope_map = {"GET": ["org:write"]}


@region_silo_endpoint
class OrganizationMissingMembersEndpoint(OrganizationEndpoint):
    publish_status = {
        "GET": ApiPublishStatus.UNKNOWN,
    }
    permission_classes = (MissingMembersPermission,)

    def _get_missing_members(
        self, organization: Organization, provider: str, integration_ids: Sequence[int]
    ) -> QuerySet[CommitAuthor]:
        member_emails = set(
            organization.member_set.exclude(email=None).values_list("email", flat=True)
        )
        member_emails.update(
            set(
                organization.member_set.exclude(user_email=None).values_list(
                    "user_email", flat=True
                )
            )
        )
        nonmember_authors = CommitAuthor.objects.filter(organization_id=organization.id).exclude(
            Q(email__in=member_emails) | Q(external_id=None)
        )

        org_repos = Repository.objects.filter(
            provider="integrations:" + provider,
            organization_id=organization.id,
            integration_id__in=integration_ids,
        ).values_list("id", flat=True)

        return (
            nonmember_authors.filter(
                commit__repository_id__in=set(org_repos),
                commit__date_added__gte=timezone.now() - timedelta(days=30),
            )
            .annotate(commit_count=Count("commit"))
            .order_by("-commit_count")
        )

    def _get_shared_email_domain(self, organization) -> str | None:
        # if a member has user_email=None, then they have yet to accept an invite
        org_owners = organization.get_members_with_org_roles(
            roles=[roles.get_top_dog().id]
        ).exclude(Q(user_email=None) | Q(user_email=""))

        def _get_email_domain(email: str) -> str | None:
            try:
                domain = Address(addr_spec=email).domain
            except Exception:
                return None

            return domain

        owner_email_domains = {_get_email_domain(owner.user_email) for owner in org_owners}

        # all owners have the same email domain
        if len(owner_email_domains) == 1:
            return owner_email_domains.pop()

        return None

    def get(self, request: Request, organization: Organization) -> Response:
        # ensure the organization has an integration with the commit feature
        integrations = integration_service.get_integrations(
            organization_id=organization.id, status=ObjectStatus.ACTIVE
        )

        def provider_reducer(dict, integration):
            if not integration.has_feature(feature=IntegrationFeatures.COMMITS):
                return dict
            if dict.get(integration.provider):
                dict[integration.provider].append(integration.id)
            else:
                dict[integration.provider] = [integration.id]

            return dict

        integration_provider_to_ids: Dict[str, Sequence[int]] = reduce(
            provider_reducer, integrations, defaultdict(list)
        )

        shared_domain = self._get_shared_email_domain(organization)

        missing_org_members = []

        for integration_provider, integration_ids in integration_provider_to_ids.items():
            # TODO(cathy): allow other integration providers
            if integration_provider != "github":
                continue

            queryset = self._get_missing_members(
                organization, integration_provider, integration_ids
            )

            if shared_domain:
                queryset = queryset.filter(email__endswith=shared_domain)

            query = request.GET.get("query")
            if query:
                tokens = tokenize_query(query)
                if "query" in tokens:
                    query_value = " ".join(tokens["query"])
                    queryset = queryset.filter(
                        Q(email__icontains=query_value) | Q(external_id__icontains=query_value)
                    )

            missing_members_for_integration = {
                "integration": integration_provider,
                "users": serialize(
                    list(queryset), request.user, serializer=MissingOrgMemberSerializer()
                ),
            }

            missing_org_members.append(missing_members_for_integration)

        return Response(
            missing_org_members,
            status=status.HTTP_200_OK,
        )
