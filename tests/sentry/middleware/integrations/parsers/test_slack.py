from unittest.mock import MagicMock, patch, sentinel

import pytest
from django.test import RequestFactory
from django.urls import reverse

from sentry.integrations.slack.requests.command import SlackCommandRequest
from sentry.middleware.integrations.parsers.base import RegionResult
from sentry.middleware.integrations.parsers.slack import SlackRequestParser
from sentry.models.outbox import ControlOutbox
from sentry.silo.client import SiloClientError
from sentry.testutils.cases import TestCase
from sentry.testutils.silo import control_silo_test
from sentry.types.region import Region, RegionCategory
from sentry.utils.signing import sign


@control_silo_test(stable=True)
class SlackRequestParserTest(TestCase):
    get_response = MagicMock()
    factory = RequestFactory()
    region = Region("us", 1, "https://us.testserver", RegionCategory.MULTI_TENANT)

    @pytest.fixture(autouse=True)
    def patch_get_region(self):
        with patch.object(
            SlackRequestParser, "get_regions_from_organizations", return_value=[self.region]
        ):
            yield

    def setUp(self):
        self.user = self.create_user()
        self.organization = self.create_organization(owner=self.user)
        self.integration = self.create_integration(
            organization=self.organization, external_id="TXXXXXXX1", provider="slack"
        )

    def get_parser(self, path: str):
        self.request = self.factory.post(path)
        return SlackRequestParser(self.request, self.get_response)

    @pytest.mark.skip(reason="Will be implemented after frontend installation is setup")
    def test_installation(self):
        pass

    @patch.object(SlackCommandRequest, "integration")
    @patch.object(SlackCommandRequest, "validate_integration")
    @patch.object(SlackCommandRequest, "authorize")
    def test_webhook(self, mock_authorize, mock_validate_integration, mock_integration):
        # Retrieve the correct integration
        mock_integration.id = self.integration.id
        parser = self.get_parser(reverse("sentry-integration-slack-commands"))
        integration = parser.get_integration_from_request()
        assert mock_authorize.called
        assert mock_validate_integration.called
        assert integration == self.integration

        # Returns response from region
        region_response = RegionResult(response=sentinel.response)
        with patch.object(
            parser, "get_response_from_outbox_creation"
        ) as get_response_from_outbox_creation, patch.object(
            parser,
            "get_responses_from_region_silos",
            return_value={self.region.name: region_response},
        ) as mock_response_from_region:
            assert not get_response_from_outbox_creation.called
            response = parser.get_response()
            assert mock_response_from_region.called
            assert response == region_response.response
            # No outboxes will be created from the slack request parser
            assert ControlOutbox.objects.count() == 0

        # Raises SiloClientError on failure
        with pytest.raises(SiloClientError), patch.object(
            parser,
            "get_responses_from_region_silos",
            return_value={self.region.name: RegionResult(error=sentinel.error)},
        ) as mock_response_from_region:
            response = parser.get_response()
            assert mock_response_from_region.called

    def test_django_view(self):
        # Retrieve the correct integration
        parser = self.get_parser(
            reverse(
                "sentry-integration-slack-link-identity",
                kwargs={"signed_params": sign(integration_id=self.integration.id)},
            )
        )
        parser_integration = parser.get_integration_from_request()
        assert parser_integration.id == self.integration.id

        # Forwards to control silo
        with patch.object(
            parser, "get_response_from_outbox_creation"
        ) as get_response_from_outbox_creation, patch.object(
            parser, "get_response_from_control_silo", return_value="mock_response"
        ) as mock_response_from_control:
            response = parser.get_response()
            assert mock_response_from_control.called
            assert not get_response_from_outbox_creation.called
            assert response == mock_response_from_control()
