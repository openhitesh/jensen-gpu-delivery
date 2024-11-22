'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'

const FaceSwapApp = dynamic(() => import('./FaceSwapApp'), {
  ssr: false,
})

export default function FaceSwapWrapper() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <FaceSwapApp />
    </Suspense>
  )
}

