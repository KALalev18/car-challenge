import type { Metadata, Viewport } from "next"
import { QueueProvider } from "./components/live"
import { Shell } from "./components/shell"
import "./globals.css"

export const metadata: Metadata = {
  title: "Control room · Bahn",
  description: "The orders that need a person, and a Journey agent that does the legwork on the road.",
}

export const viewport: Viewport = { themeColor: "#12110e", width: "device-width", initialScale: 1 }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Brand fallback faces: Unbounded for titles, Poppins for reading, Reddit Mono for references.
            Without a network the stack falls back to Arial. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&family=Reddit+Mono:wght@400;500&family=Unbounded:wght@500;600;700&display=swap"
        />
      </head>
      <body>
        <QueueProvider>
          <Shell>{children}</Shell>
        </QueueProvider>
      </body>
    </html>
  )
}
