import type {UserReport as TUserReport} from 'sentry/types';

import {Event} from './event';
import {Group} from './group';
import {User} from './user';

export function UserFeedback(params: Partial<TUserReport> = {}): TUserReport {
  const event = Event();
  return {
    id: '123',
    name: 'Lyn',
    email: 'lyn@sentry.io',
    comments: 'Something bad happened',
    dateCreated: '2018-12-20T00:00:00.000Z',
    issue: Group(),
    eventID: event.id,
    event,
    user: User(),
    ...params,
  };
}
