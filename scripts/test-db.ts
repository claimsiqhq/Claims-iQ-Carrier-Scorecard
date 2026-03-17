import pg from "pg";

const url = process.env.SUPABASE_DATABASE_URL;
console.log("URL exists:", !!url);
console.log("URL starts with:", url?.substring(0, 20));

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

console.log("Connecting...");
client.connect()
  .then(() => {
    console.log("Connected!");
    return client.query("SELECT count(*) FROM claims");
  })
  .then((res) => {
    console.log("Claims count:", res.rows);
    return client.end();
  })
  .catch((err) => {
    console.log("Error:", err.message);
    client.end().catch(() => {});
    process.exit(1);
  });
