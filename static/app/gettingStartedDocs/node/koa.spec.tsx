import {render, screen} from 'sentry-test/reactTestingLibrary';

import {StepTitle} from 'sentry/components/onboarding/gettingStartedDoc/step';

import {GettingStartedWithKoa, steps} from './koa';

describe('GettingStartedWithKoa', function () {
  it('all products are selected', function () {
    const {container} = render(<GettingStartedWithKoa dsn="test-dsn" />);

    // Steps
    for (const step of steps({
      installSnippet: 'test-install-snippet',
      importContent: 'test-import-content',
      initContent: 'test-init-content',
      hasPerformanceMonitoring: true,
    })) {
      expect(
        screen.getByRole('heading', {name: step.title ?? StepTitle[step.type]})
      ).toBeInTheDocument();
    }

    expect(container).toSnapshot();
  });
});
