import {Fragment} from 'react';
import styled from '@emotion/styled';

import {Alert} from 'sentry/components/alert';
import ExternalLink from 'sentry/components/links/externalLink';
import {Layout, LayoutProps} from 'sentry/components/onboarding/gettingStartedDoc/layout';
import {ModuleProps} from 'sentry/components/onboarding/gettingStartedDoc/sdkDocumentation';
import {StepType} from 'sentry/components/onboarding/gettingStartedDoc/step';
import {t, tct} from 'sentry/locale';

// Configuration Start
export const steps = ({
  dsn,
}: Partial<Pick<ModuleProps, 'dsn'>> = {}): LayoutProps['steps'] => [
  {
    type: StepType.INSTALL,
    description: (
      <p>
        {tct('Install our Go FastHTTP SDK using [code:go get]:', {
          code: <code />,
        })}
      </p>
    ),
    configurations: [
      {
        language: 'bash',
        code: 'go get github.com/getsentry/sentry-go/fasthttp',
      },
    ],
  },
  {
    type: StepType.CONFIGURE,
    description: t(
      "Import and initialize the Sentry SDK early in your application's setup:"
    ),
    configurations: [
      {
        language: 'go',
        code: `
import (
  "fmt"
  "net/http"

  "github.com/getsentry/sentry-go"
  sentryfasthttp "github.com/getsentry/sentry-go/fasthttp"
)

// To initialize Sentry's handler, you need to initialize Sentry itself beforehand
if err := sentry.Init(sentry.ClientOptions{
  Dsn: "${dsn}",
  EnableTracing: true,
  // Set TracesSampleRate to 1.0 to capture 100%
  // of transactions for performance monitoring.
  // We recommend adjusting this value in production,
  TracesSampleRate: 1.0,
}); err != nil {
  fmt.Printf("Sentry initialization failed: %v\n", err)
}

// Create an instance of sentryfasthttp
sentryHandler := sentryfasthttp.New(sentryfasthttp.Options{})

// After creating the instance, you can attach the handler as one of your middleware
fastHTTPHandler := sentryHandler.Handle(func(ctx *fasthttp.RequestCtx) {
  panic("y tho")
})

fmt.Println("Listening and serving HTTP on :3000")

// And run it
if err := fasthttp.ListenAndServe(":3000", fastHTTPHandler); err != nil {
  panic(err)
}
        `,
      },
      {
        description: (
          <Fragment>
            <strong>{t('Options')}</strong>
            <p>
              {tct(
                '[sentryfasthttpCode:sentryfasthttp] accepts a struct of [optionsCode:Options] that allows you to configure how the handler will behave.',
                {sentryfasthttpCode: <code />, optionsCode: <code />}
              )}
            </p>
            {t('Currently it respects 3 options:')}
          </Fragment>
        ),
        language: 'go',
        code: `
// Repanic configures whether Sentry should repanic after recovery, in most cases, it defaults to false,
// as fasthttp doesn't include its own Recovery handler.
Repanic bool
// WaitForDelivery configures whether you want to block the request before moving forward with the response.
// Because fasthttp doesn't include its own "Recovery" handler, it will restart the application,
// and the event won't be delivered otherwise.
WaitForDelivery bool
// Timeout for the event delivery requests.
Timeout time.Duration
        `,
      },
    ],
  },
  {
    title: t('Usage'),
    description: (
      <Fragment>
        <p>
          {tct(
            "[sentryfasthttpCode:sentryfasthttp] attaches an instance of [sentryHubLink:*sentry.Hub] to the request's context, which makes it available throughout the rest of the request's lifetime. You can access it by using the [getHubFromContextCode:sentryfasthttp.GetHubFromContext()] method on the context itself in any of your proceeding middleware and routes. And it should be used instead of the global [captureMessageCode:sentry.CaptureMessage], [captureExceptionCode:sentry.CaptureException], or any other calls, as it keeps the separation of data between the requests.",
            {
              sentryfasthttpCode: <code />,
              sentryHubLink: (
                <ExternalLink href="https://godoc.org/github.com/getsentry/sentry-go#Hub" />
              ),
              getHubFromContextCode: <code />,
              captureMessageCode: <code />,
              captureExceptionCode: <code />,
            }
          )}
        </p>
        <AlertWithoutMarginBottom>
          {tct(
            "Keep in mind that [sentryHubCode:*sentry.Hub] won't be available in middleware attached before [sentryfasthttpCode:sentryfasthttp]!",
            {sentryfasthttpCode: <code />, sentryHubCode: <code />}
          )}
        </AlertWithoutMarginBottom>
      </Fragment>
    ),
    configurations: [
      {
        language: 'go',
        code: `
func enhanceSentryEvent(handler fasthttp.RequestHandler) fasthttp.RequestHandler {
  return func(ctx *fasthttp.RequestCtx) {
    if hub := sentryfasthttp.GetHubFromContext(ctx); hub != nil {
      hub.Scope().SetTag("someRandomTag", "maybeYouNeedIt")
    }
    handler(ctx)
  }
}

// Later in the code
sentryHandler := sentryfasthttp.New(sentryfasthttp.Options{
  Repanic: true,
  WaitForDelivery: true,
})

defaultHandler := func(ctx *fasthttp.RequestCtx) {
  if hub := sentryfasthttp.GetHubFromContext(ctx); hub != nil {
    hub.WithScope(func(scope *sentry.Scope) {
      scope.SetExtra("unwantedQuery", "someQueryDataMaybe")
      hub.CaptureMessage("User provided unwanted query string, but we recovered just fine")
    })
  }
  ctx.SetStatusCode(fasthttp.StatusOK)
}

fooHandler := enhanceSentryEvent(func(ctx *fasthttp.RequestCtx) {
  panic("y tho")
})

fastHTTPHandler := func(ctx *fasthttp.RequestCtx) {
  switch string(ctx.Path()) {
  case "/foo":
    fooHandler(ctx)
  default:
    defaultHandler(ctx)
  }
}

fmt.Println("Listening and serving HTTP on :3000")

if err := fasthttp.ListenAndServe(":3000", sentryHandler.Handle(fastHTTPHandler)); err != nil {
  panic(err)
}
        `,
      },
      {
        description: (
          <strong>
            {tct('Accessing Request in [beforeSendCode:BeforeSend] callback', {
              beforeSendCode: <code />,
            })}
          </strong>
        ),
        language: 'go',
        code: `
sentry.Init(sentry.ClientOptions{
  Dsn: "${dsn}",
  BeforeSend: func(event *sentry.Event, hint *sentry.EventHint) *sentry.Event {
    if hint.Context != nil {
      if ctx, ok := hint.Context.Value(sentry.RequestContextKey).(*fasthttp.RequestCtx); ok {
        // You have access to the original Context if it panicked
        fmt.Println(string(ctx.Request.Host()))
      }
    }
    return event
  },
})
        `,
      },
    ],
  },
];
// Configuration End

export function GettingStartedWithFastHttp({dsn, ...props}: ModuleProps) {
  return <Layout steps={steps({dsn})} {...props} />;
}

export default GettingStartedWithFastHttp;

const AlertWithoutMarginBottom = styled(Alert)`
  margin-bottom: 0;
`;
