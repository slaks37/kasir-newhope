import pg from 'pg';
const URL='postgres://postgres@127.0.0.1:5432/postgres';
export const conn=async()=>{const c=new pg.Client({connectionString:URL});c.on('error',()=>{});await c.connect();return c;};
export const line=(s)=>console.log(s);
