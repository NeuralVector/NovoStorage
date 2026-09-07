# NovoStorage

A Secure Cloud Data Storage Solution

## Local PostgreSQL

Start the local PostgreSQL container with:

```sh
pnpm db:start
```

The application uses these settings:

```env
POSTGRES_URL=postgresql://novostorage:novostorage@localhost:5432/novostorage
STORAGE_QUOTA_BYTES=10737418240
```

`STORAGE_QUOTA_BYTES` is the per-user quota. The default is 10 GiB.

Stop the container with:

```sh
pnpm db:stop
```
