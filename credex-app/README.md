# Lendr Protocol — Sovereign Vault

A fully functional DeFi lending/borrowing protocol UI built with Next.js 15, TypeScript, Tailwind CSS v4, Redux Toolkit, TanStack Query, GSAP, and WebGL.

## Tech Stack

- **Framework**: Next.js 15.x (App Router)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS v4
- **State**: Redux Toolkit (@reduxjs/toolkit)
- **Server State**: TanStack Query v5 (real-time polling)
- **Animations**: GSAP 3 + WebGL particle system
- **Charts**: Recharts
- **Fonts**: Bebas Neue, DM Mono, Plus Jakarta Sans

## Project Structure

```
lendr-app/
├── app/
│   ├── page.tsx                  # Landing page (WebGL + GSAP)
│   ├── layout.tsx                # Root layout with Providers
│   ├── globals.css               # Tailwind v4 theme + animations
│   ├── providers.tsx             # Redux + TanStack + YieldTicker
│   └── app/
│       ├── layout.tsx            # App shell layout
│       ├── page.tsx              # Hub — wallet gate + mode select
│       ├── borrow/page.tsx       # Borrow dashboard
│       ├── lend/page.tsx         # Lend portal
│       ├── portfolio/page.tsx    # Portfolio overview
│       └── score-history/page.tsx# Credit score & history
├── components/
│   ├── ui/
│   │   ├── index.tsx             # StatCard, ProgressBar, SignalRow, Table, etc.
│   │   ├── Toast.tsx             # Toast notification system
│   │   ├── ChartWrapper.tsx      # SSR-safe Recharts wrapper
│   │   ├── DynamicChart.tsx      # Client-only Recharts re-exports
│   │   └── CustomCursor.tsx      # Custom cursor with event delegation
│   ├── layout/AppShell.tsx       # Sidebar nav + header + toast container
│   ├── wallet/WalletButton.tsx   # Connect/disconnect with balance display
│   ├── borrow/ZKProofModal.tsx   # Live ZK proof execution modal
│   └── lend/DepositModal.tsx     # USDC deposit flow modal
├── hooks/
│   ├── useWallet.ts              # Wallet connect/disconnect
│   ├── useWalletGuard.ts         # Route protection redirect
│   ├── useZKProof.ts             # Full Cairo VM simulation flow
│   ├── useDeposit.ts             # USDC deposit flow
│   ├── useQueries.ts             # TanStack Query hooks (polling)
│   ├── usePortfolio.ts           # Portfolio + score history hooks
│   └── useToast.ts               # Toast convenience helpers
├── store/
│   ├── index.ts                  # Configured Redux store
│   ├── hooks.ts                  # Typed useAppDispatch/useAppSelector
│   ├── walletSlice.ts            # Wallet state machine
│   ├── zkSlice.ts                # ZK proof step state
│   ├── financeSlice.ts           # Loans, deposits, yield tick
│   └── toastSlice.ts             # Toast notifications
├── lib/
│   └── api.ts                    # Mock blockchain API service
└── types/
    └── index.ts                  # All TypeScript types
```

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Key Flows

### Borrow Flow
1. Connect wallet (top-right button)
2. Navigate to **Borrow** via Hub or sidebar
3. Fill in amount, collateral asset, and duration
4. Click **Generate ZK Proof & Borrow** — live Cairo VM modal runs
5. Loan appears in Active Positions table with repay button

### Lend Flow  
1. Connect wallet
2. Navigate to **Lend**
3. Enter USDC amount and click **Deposit USDC**
4. Step-by-step deposit modal confirms transaction
5. Position appears in My Deposits with live yield accrual

### Score Reveal
1. Navigate to **Score History**
2. Click **Reveal My Score** — ZK decryption simulation runs
3. Score animates in with tier breakdown

## Real-Time Features
- Pool stats (TVL, APY, active loans) refresh every **10 seconds**
- Activity feed refreshes every **6 seconds**
- Deposit yield accrues every **5 seconds** in Redux state
- Collateral prices refresh every **30 seconds**

## Notes
- All blockchain interactions are **simulated** — no real wallet or network required
- The ZK proof modal simulates a real Cairo VM execution with step-by-step logging
- Wallet "connection" uses a mock address (`0x4e...f291`) with Gold tier status
