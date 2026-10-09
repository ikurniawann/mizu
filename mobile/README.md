# Mizu Member

Expo app for Mizu members. Members sign in with a WhatsApp code, view spa bookings, and open the public booking site to reserve a treatment.

## Run locally

```bash
npm ci
npx expo start
```

Set these public environment variables for the device or simulator:

- `EXPO_PUBLIC_API_URL`: member API origin, such as `http://localhost:3459` for a local simulator.
- `EXPO_PUBLIC_SITE_URL`: Next.js site origin used by the **Booking treatment** button, such as `http://localhost:3000`.

A physical device needs network addresses it can reach; `localhost` refers to the device itself. The API and site can use different origins.

## Check changes

```bash
npx tsc --noEmit
npx vitest run
```
