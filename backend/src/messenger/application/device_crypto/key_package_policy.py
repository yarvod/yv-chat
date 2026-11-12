"""Server-side age limit for packages queued for new MLS membership."""

from datetime import timedelta

# Our OpenMLS client generates packages with an 84-day lifetime. Leave a
# margin for clock skew and time in transit. The client still verifies the
# actual signed lifetime before consuming any package.
KEY_PACKAGE_MAX_QUEUE_AGE = timedelta(days=83)
