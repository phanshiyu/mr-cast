Rate limiting for the Orders API

Someone hammering POST /orders can take the API down. This limits each visitor to 20 orders a minute, counted in Redis so every server shares the count, and answers the 21st with a 429 and a Retry-After header.

Also: orders are priced from the pricing module instead of a flat 10 per item, an empty order is refused, and a new order publishes order.created to the queue. The old in-memory throttle is deleted, since nothing used it.
