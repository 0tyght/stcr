# เปิด STCR ผ่านอินเทอร์เน็ตชั่วคราว

เปิด PowerShell ที่โฟลเดอร์โปรเจกต์ แล้วใช้คำสั่งเดียว:

```powershell
npm run public:start
```

คำสั่งนี้จะดำเนินการให้อัตโนมัติ:

1. เปิด MySQL และ Node-RED ด้วย Flow ล่าสุด
2. สร้าง Cloudflare Quick Tunnel
3. ตรวจว่า API ใช้งานผ่านอินเทอร์เน็ตได้
4. เขียน URL ใหม่ลง `public/runtime-config.json`
5. Commit และ Push URL ขึ้นสาขา `main`
6. รอ GitHub Pages Deploy แล้วแสดงลิงก์เว็บ

เปิดหน้าต่าง PowerShell ค้างไว้ระหว่างทดสอบ กด `Q` เพื่อปิด Tunnel, Node-RED และ MySQL พร้อมกัน

หากต้องการรันแบบเบื้องหลัง:

```powershell
npm run public:start -- -Background
```

ปิดบริการที่รันเบื้องหลัง:

```powershell
npm run public:stop
```

ทดสอบโดยไม่ Commit/Push:

```powershell
npm run public:start -- -SkipGitPush
```

เว็บถาวร: `https://0tyght.github.io/stcr/`

> Cloudflare Quick Tunnel ใช้ทดสอบชั่วคราวเท่านั้น URL จะเปลี่ยนทุกครั้งที่เปิดใหม่ และเครื่องที่รัน Node-RED ต้องเปิดอยู่ตลอดการทดสอบ ห้ามเก็บรหัสผ่านหรือ Token ไว้ใน `runtime-config.json`
