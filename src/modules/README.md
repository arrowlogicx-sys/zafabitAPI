# Backend Module Map

This backend stays as one deployable Express application, but its API is owned by
explicit business modules. This keeps startup complexity low while giving the
customer app, maid app, admin panel, and shared services clear boundaries.

## Current Modules

| Module           | Public mount            | Owner      | Main responsibility                                          |
| ---------------- | ----------------------- | ---------- | ------------------------------------------------------------ |
| `auth`           | `/api/v1/auth`          | shared     | JWT, OTP, sessions, role access                              |
| `customer`       | `/api/v1/customers`     | customer   | Profile, addresses, wallet, referrals, notifications         |
| `serviceCatalog` | `/api/v1/services`      | shared     | Services, pricing inputs, catalog data                       |
| `booking`        | `/api/v1/bookings`      | shared     | Booking creation, dispatch, tracking, status workflow        |
| `payment`        | `/api/v1/payments`      | shared     | Payment initiation, verification, refunds, settlement        |
| `review`         | `/api/v1/reviews`       | shared     | Reviews, ratings, feedback                                   |
| `support`        | `/api/v1/support`       | shared     | Tickets, complaints, help flows                              |
| `maid`           | `/api/v1/maids`         | maid       | Profile, documents, availability, jobs, earnings, onboarding |
| `admin`          | `/api/v1/admin`         | admin      | Dashboard, user management, verification, reports            |
| `agent`          | `/api/v1/agents`        | operations | Field operations                                             |
| `notification`   | `/api/v1/notifications` | shared     | In-app notifications and provider hooks                      |
| `cart`           | `/api/v1/cart`          | customer   | Cart items and checkout preparation                          |
| `promotion`      | `/api/v1/promotions`    | shared     | Promo codes and discounts                                    |
| `content`        | `/api/v1/content`       | shared     | Home content, CMS, localization                              |
| `location`       | `/api/v1/locations`     | shared     | Search, serviceability, geo helpers                          |
| `system`         | `/api/v1/system`        | platform   | Health, legal content, dispatch metrics                      |

## Rules For New Work

1. Add or change public API mounts only through `src/modules/index.js`.
2. Keep route files thin: route, middleware, validation, controller handler.
3. Put reusable business logic in module-level service files before it is shared.
4. Keep customer, maid, and admin behavior separate at the API boundary, but share
   booking, payment, notification, upload, location, and auth logic internally.
5. Split a module into a separately deployed microservice only after it has its own
   scaling, ownership, data, or reliability requirement.

## Split Later First

If the app grows beyond the modular monolith, split in this order:

1. Notification worker/service.
2. Payment and settlement service.
3. File upload/media service.
4. Matching/dispatch worker.
5. Customer, maid, and admin APIs only after the above boundaries are stable.
