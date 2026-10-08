import type { ReactNode } from 'react'
import { AbsoluteFill, Series } from 'remotion'

import { loadFonts } from './fonts'
import { sec } from './motion'
import { EndCard, TitleCard } from './shots/Brand'
import { Footage, footageDuration } from './shots/Footage'
import { MissChart } from './shots/MissChart'
import { TextCard } from './shots/TextCard'
import { useRecordings } from './term/data'
import type { Recordings } from './term/data'
import { C } from './theme'
import { SHOTS, type Shot } from './timeline'

loadFonts()

export function shotSeconds(shot: Shot): number {
  return shot.kind === 'footage' ? footageDuration(shot.segments) : shot.seconds
}

export function totalFrames(): number {
  return SHOTS.reduce((sum, s) => sum + sec(shotSeconds(s)), 0)
}

function render(shot: Shot, recs: Recordings): ReactNode {
  switch (shot.kind) {
    case 'card':
      return (
        <TextCard setup={shot.setup} punch={shot.punch} punchAt={shot.punchAt}>
          {shot.chart ? <MissChart start={(shot.punchAt ?? 0.55) + 0.25} /> : null}
        </TextCard>
      )
    case 'title':
      return <TitleCard />
    case 'end':
      return <EndCard />
    case 'footage':
      return (
        <Footage
          rec={recs[shot.rec]}
          segments={shot.segments}
          camera={shot.camera}
          highlights={shot.highlights}
          fade={shot.fade}
          isOpening={shot === SHOTS[0]}
        />
      )
  }
}

export function Demo() {
  const recs = useRecordings()
  if (!recs) return <AbsoluteFill style={{ background: C.ground }} />
  return (
    <AbsoluteFill style={{ background: C.ground }}>
      <Series>
        {SHOTS.map(shot => (
          <Series.Sequence key={shot.id} durationInFrames={sec(shotSeconds(shot))} name={shot.id}>
            {render(shot, recs)}
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  )
}
