import express from "express";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(), PORT=Number(process.env.PORT||3000);
const MASTER_KEY=process.env.SHABAKATY_MASTER_KEY||"change-this-before-production";
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

const db=new Database(path.join(__dirname,"shabakaty.db"));
db.pragma("journal_mode=WAL");
db.exec(`CREATE TABLE IF NOT EXISTS routers(
 id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,host TEXT NOT NULL,
 port INTEGER NOT NULL,secure INTEGER NOT NULL,username TEXT NOT NULL,
 password_enc TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS cards(
 id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,
 password TEXT NOT NULL,customer TEXT,price INTEGER DEFAULT 0,
 duration TEXT,speed TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS expenses(
 id INTEGER PRIMARY KEY AUTOINCREMENT,agent TEXT NOT NULL,q100 INTEGER DEFAULT 0,
 q200 INTEGER DEFAULT 0,q300 INTEGER DEFAULT 0,other_qty INTEGER DEFAULT 0,
 other_price INTEGER DEFAULT 0,total_value INTEGER NOT NULL,note TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);

const key=()=>crypto.createHash("sha256").update(MASTER_KEY).digest();
function enc(v){const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",key(),iv);const x=Buffer.concat([c.update(v,"utf8"),c.final()]);return Buffer.concat([iv,c.getAuthTag(),x]).toString("base64url")}
function dec(v){const b=Buffer.from(v,"base64url"),d=crypto.createDecipheriv("aes-256-gcm",key(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString("utf8")}

async function ros({host,port,secure,username,password,apiPath="/system/resource"}){
  const url=`${secure?"https":"http"}://${host}:${port}/rest${apiPath}`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const r=await fetch(url,{headers:{Authorization:"Basic "+Buffer.from(`${username}:${password}`).toString("base64")},signal:controller.signal});
    const t=await r.text(); if(!r.ok) throw new Error(`RouterOS HTTP ${r.status}: ${t.slice(0,200)}`);
    return t?JSON.parse(t):{};
  }finally{clearTimeout(timer)}
}

app.get("/api/health",(_,res)=>res.json({ok:true,service:"SHABAKATY PLUS"}));

app.post("/api/mikrotik/test",async(req,res)=>{
  try{
    const {host,username,password}=req.body, secure=Boolean(req.body.secure), port=Number(req.body.port||(secure?443:80));
    if(!host||!username||!password) throw new Error("IP واسم المستخدم وكلمة المرور مطلوبة");
    const r=await ros({host,port,secure,username,password});
    res.json({ok:true,message:"تم الاتصال بـ MikroTik بنجاح",router:{version:r.version||null,uptime:r.uptime||null}});
  }catch(e){res.status(400).json({ok:false,message:e.name==="AbortError"?"انتهت مهلة الاتصال":e.message})}
});

app.post("/api/mikrotik/save",async(req,res)=>{
  try{
    const {host,username,password}=req.body, secure=Boolean(req.body.secure), port=Number(req.body.port||(secure?443:80));
    const name=String(req.body.name||"My MikroTik");
    if(!host||!username||!password) throw new Error("IP واسم المستخدم وكلمة المرور مطلوبة");
    const r=await ros({host,port,secure,username,password});
    const x=db.prepare("INSERT INTO routers(name,host,port,secure,username,password_enc) VALUES(?,?,?,?,?,?)")
      .run(name,host,port,secure?1:0,username,enc(password));
    res.json({ok:true,id:x.lastInsertRowid,message:"تم التحقق والحفظ",version:r.version||null});
  }catch(e){res.status(400).json({ok:false,message:e.message})}
});

app.get("/api/mikrotik/routers",(_,res)=>res.json({ok:true,routers:db.prepare("SELECT id,name,host,port,secure,username,created_at FROM routers ORDER BY id DESC").all()}));

app.post("/api/cards",(req,res)=>{
  try{
    const {username,password,customer="",price=0,duration="",speed=""}=req.body;
    if(!username||!password) throw new Error("اسم المستخدم وكلمة السر مطلوبان");
    const x=db.prepare("INSERT INTO cards(username,password,customer,price,duration,speed) VALUES(?,?,?,?,?,?)")
      .run(username,password,customer,Number(price),duration,speed);
    res.json({ok:true,id:x.lastInsertRowid});
  }catch(e){res.status(400).json({ok:false,message:e.message})}
});
app.get("/api/cards",(_,res)=>res.json({ok:true,cards:db.prepare("SELECT id,username,customer,price,duration,speed,created_at FROM cards ORDER BY id DESC").all()}));

app.post("/api/expenses",(req,res)=>{
  const {agent,q100=0,q200=0,q300=0,other_qty=0,other_price=0,note=""}=req.body;
  const total=Number(q100)*100+Number(q200)*200+Number(q300)*300+Number(other_qty)*Number(other_price);
  if(!agent||total<0)return res.status(400).json({ok:false,message:"بيانات المخروجات غير صحيحة"});
  const x=db.prepare("INSERT INTO expenses(agent,q100,q200,q300,other_qty,other_price,total_value,note) VALUES(?,?,?,?,?,?,?,?)")
    .run(agent,+q100,+q200,+q300,+other_qty,+other_price,total,note);
  res.json({ok:true,id:x.lastInsertRowid,total});
});
app.get("/api/expenses",(_,res)=>res.json({ok:true,expenses:db.prepare("SELECT * FROM expenses ORDER BY id DESC").all()}));

app.use((_,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`SHABAKATY PLUS running on :${PORT}`));