import { ImageResponse } from "next/og"

export const runtime = "edge"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0E6E5C 0%, #0a5a4a 50%, #0E6E5C 100%)",
          fontFamily: "sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative pattern */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.06,
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent, transparent 35px, rgba(255,255,255,0.5) 35px, rgba(255,255,255,0.5) 36px)",
          }}
        />

        {/* Gold accent line */}
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 80,
            right: 80,
            height: 2,
            background: "#C8A84E",
            opacity: 0.4,
          }}
        />

        {/* Cross icon */}
        <svg
          viewBox="0 0 24 24"
          width="120"
          height="120"
          style={{ marginBottom: 32 }}
        >
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

        {/* App name */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: "#ffffff",
            letterSpacing: -1,
            textAlign: "center",
            lineHeight: 1.1,
          }}
        >
          خدمتي
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 28,
            color: "rgba(255,255,255,0.75)",
            marginTop: 16,
            textAlign: "center",
          }}
        >
          كنيسة السيدة العذراء وأي حوف
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 22,
            color: "rgba(255,255,255,0.5)",
            marginTop: 12,
            textAlign: "center",
          }}
        >
          تطبيق إدارة الخدمة
        </div>

        {/* Gold bottom line */}
        <div
          style={{
            position: "absolute",
            bottom: 40,
            left: 80,
            right: 80,
            height: 2,
            background: "#C8A84E",
            opacity: 0.4,
          }}
        />
      </div>
    ),
    { ...size }
  )
}
