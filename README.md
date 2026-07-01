# 🚆 Live Victorian Train Tracker

A real-time (every 30s) map of Victoria's train network, showing live positions for both Metro and V/Line services using the [Transport Victoria GTFS Realtime API](https://opendata.transport.vic.gov.au/).

## Features

- **Live train positions** updated every 30 seconds via the GTFS Realtime vehicle positions feed
- **Metro & V/Line toggle** — switch between networks with an animated map transition
- **Per-line colouring** for Metro trains:
  - 🟣 Werribee / Laverton / Williamstown / Showgrounds — Pink
  - 🔵 Sunbury / Craigieburn / Pakenham — Light Blue
  - 🟡 Upfield / Cranbourne — Yellow
  - 🔴 Hurstbridge / Mernda — Red
  - 🟦 Lilydale / Belgrave / Alamein / Glen Waverley — Dark Blue
  - 🟢 Frankston — Dark Green
- **Direction arrow** on each carriage set showing heading
- **Proportional sizing** — trains scale with zoom level
- **6-carriage consists** for Metro trains and long V/Line sets (BDE trips)
- **Dark mode** map (CartoDB Dark Matter) with a matching PrimeVue dark UI

## Tech Stack

- **Frontend** — Vue 3 + Vite + [PrimeVue 4](https://primevue.org/) (Aura theme, dark mode)
- **Map** — [Leaflet](https://leafletjs.com/) with CartoDB Dark Matter tiles
- **Backend** — Node.js + Express, decoding GTFS protobuf via [`gtfs-realtime-bindings`](https://github.com/MobilityData/gtfs-realtime-bindings)
- **Monorepo** — npm workspaces with `concurrently` for dev

## Getting Started

### Prerequisites

- Node.js 18+
- A [Transport Victoria Open Data](https://opendata.transport.vic.gov.au/) API key (subscribe to the GTFS Realtime V/Line and Metro products)

### Setup

```bash
git clone https://github.com/your-username/live_metro_vic_trainline.git
cd live_metro_vic_trainline
npm install
```

Create a `.env` file in the project root:

```env
API_KEY=your_transport_vic_api_key_here
PORT=3001
```

### Run

```bash
npm run dev
```

Opens the app at [http://localhost:5173](http://localhost:5173) with the Express server proxied on port 3001.

## API Notes

The GTFS Realtime feed caches for **30 seconds** — polling more frequently yields no new data. The app polls at exactly 30s intervals.
