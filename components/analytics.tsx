'use client'

import Script from 'next/script'

const GOOGLE_MEASUREMENT_ID = 'G-5VG6Y3F1W8'  

export function Analytics() {
  return (
    <Script
      src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_MEASUREMENT_ID}`}
      strategy='afterInteractive'
      onLoad={() => {
        // @ts-ignore
        window.dataLayer = window.dataLayer || []
        function gtag() {
          // @ts-ignore
          dataLayer.push(arguments)
        }
        // @ts-ignore
        gtag('js', new Date())
        // @ts-ignore
        gtag('config', GOOGLE_MEASUREMENT_ID)
      }}
    />
  )
}
