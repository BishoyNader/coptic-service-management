import { ImageResponse } from "next/og"

export const runtime = "edge"
export const size = { width: 32, height: 32 }
export const contentType = "image/png"

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0E6E5C",
          borderRadius: 6,
        }}
      >
        <svg viewBox="0 0 24 24" width="22" height="22">
          <circle cx="12" cy="12" r="11" fill="rgba(200,168,78,0.2)" />
          <g stroke="#C8A84E" strokeWidth="2" strokeLinecap="round" fill="none">
            <path d="M12 3.5v17M3.5 12h17" />
            <path d="M12 6.5l1.9-2.2M12 6.5L10.1 4.3M12 17.5l1.9 2.2M12 17.5l-1.9 2.2" />
          </g>
          <rect
            x="8.8"
            y="8.8"
            width="6.4"
            height="6.4"
            rx="1.2"
            stroke="#C8A84E"
            strokeWidth="1.6"
            fill="none"
          />
          <circle cx="12" cy="12" r="1.3" fill="#C8A84E" />
        </svg>
      </div>
    ),
    { ...size }
  )
}
