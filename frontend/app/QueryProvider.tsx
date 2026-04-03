'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime:        60 * 60 * 1000, // 1 hour — don't refetch on revisit
        gcTime:           2 * 60 * 60 * 1000, // 2 hours — keep in memory after unused
        retry:            1,
        refetchOnWindowFocus: false,
      },
    },
  }))

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
