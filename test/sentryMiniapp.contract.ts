import type * as Sentry from '@xumoses/sentry-miniapp';

import type { SentryMiniappReplaySdk } from '../src/types';

type AssertSdk<T extends SentryMiniappReplaySdk> = T;

export type XumosesSdkContract = AssertSdk<typeof Sentry>;
