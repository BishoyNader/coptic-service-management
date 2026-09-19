import { ImageResponse } from "next/og"

export const runtime = "edge"
export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
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
          borderRadius: 40,
        }}
      >
        <svg viewBox="0 0 24 24" width="120" height="120">
          <circle cx="12" cy="12" r="11" fill="rgba(200,168,78,0.15)" />
          <g stroke="#C8A84E" strokeWidth="1.8" strokeLinecap="round" fill="none">
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
