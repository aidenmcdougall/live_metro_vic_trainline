import express from 'express'
import cors from 'cors'
import axios from 'axios'
import GtfsRealtimeBindings from 'gtfs-realtime-bindings'
import { config } from 'dotenv'

const dotenvResult = config({ path: '../.env' })
console.log('dotenv path:', new URL('../.env', import.meta.url).pathname)
if (dotenvResult.error) console.warn('dotenv error:', dotenvResult.error.message)

const app = express()
app.use(cors())

const API_URLS = {
  vline: 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/vline/vehicle-positions',
  metro: 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/metro/vehicle-positions',
}

app.get('/api/vehicles', async (_req, res) => {
  const network = _req.query.network === 'metro' ? 'metro' : 'vline'
  const apiUrl = API_URLS[network]
  const apiKey = process.env.API_KEY

  console.log('API key present:', !!apiKey, '| length:', apiKey?.length, '| starts with:', apiKey?.slice(0, 4))

  try {
    const response = await axios.get(apiUrl, {
      headers: apiKey ? { KeyId: apiKey, 'Ocp-Apim-Subscription-Key': apiKey } : {},
      responseType: 'arraybuffer',
    })

    console.log('Upstream status:', response.status, '| bytes:', response.data.byteLength)

    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(response.data)
    )

    const vehicles = feed.entity
      .filter(e => e.vehicle?.position)
      .map(e => ({
        id: e.id,
        tripId: e.vehicle.trip?.tripId ?? null,
        routeId: e.vehicle.trip?.routeId ?? null,
        lat: e.vehicle.position.latitude,
        lng: e.vehicle.position.longitude,
        bearing: e.vehicle.position.bearing ?? null,
        speed: e.vehicle.position.speed != null
          ? Math.round(e.vehicle.position.speed * 3.6)
          : null,
        label: e.vehicle.vehicle?.label ?? null,
        timestamp: e.vehicle.timestamp ? Number(e.vehicle.timestamp) : null,
      }))

    console.log('Vehicles found:', vehicles.length)
    res.json({ vehicles, feedTimestamp: Number(feed.header.timestamp) })
  } catch (err) {
    if (err.response) {
      console.error('Upstream error:', err.response.status, err.response.headers['content-type'])
      const body = Buffer.from(err.response.data).toString('utf8')
      console.error('Response body:', body)
    } else {
      console.error('Error:', err.message)
    }
    res.status(502).json({ error: 'Failed to fetch vehicle positions from upstream API' })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
