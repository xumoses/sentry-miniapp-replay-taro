import { Button, Text, View } from '@tarojs/components';
import { useState } from 'react';

import * as Sentry from 'sentry-miniapp';
import { useTaroReplay } from '@xumoses/sentry-miniapp-replay-taro/react';

export default function ReplaySyntheticPage() {
  const [count, setCount] = useState(0);
  const replay = useTaroReplay({
    sdk: Sentry,
    // This page renders synthetic constants only. Keep the default `true` on real pages.
    privacy: { maskAllText: false },
    limits: { maxDurationMs: 30_000 },
  });

  return (
    <View>
      <Text>Replay state: {replay.state}</Text>
      <Text>Synthetic count: {count}</Text>
      <Button onClick={() => setCount((value) => value + 1)}>Increase synthetic count</Button>
      <Button onClick={() => void replay.stop('manual')}>Stop and send Replay</Button>
      {replay.error ? <Text>Replay error: {replay.error.message}</Text> : null}
    </View>
  );
}
