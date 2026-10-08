import { Composition } from 'remotion'

import { Demo, totalFrames } from './Demo'
import { FPS, HEIGHT, WIDTH } from './theme'

export function Root() {
  return (
    <Composition
      id="LoadingDemo"
      component={Demo}
      durationInFrames={totalFrames()}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  )
}
