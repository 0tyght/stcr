# Adding a Company

ข้อมูลที่ใช้แสดงบริษัททั้งหมดอยู่ใน `src/config/companies.ts` การเพิ่มบริษัทใหม่ไม่ควรเพิ่มเงื่อนไขชื่อบริษัทใน component หรือ CSS

## ขั้นตอน

1. เพิ่มไฟล์โลโก้ใน `src/assets`
2. เพิ่ม entry ใหม่ใน object `companies`
3. กำหนดบัญชีอย่างน้อยหนึ่งบัญชีใน `accounts`
4. กำหนดข้อความหรือรูปสำหรับ Login/Sidebar ใน `brand`
5. กำหนดโลโก้และตำแหน่งใน PDF ผ่าน `report.logoBox`
6. กำหนดชุดสีทั้งหมดใน `theme`
7. กำหนด `mockData` เพื่อเลือกและแปลงหมายเลขเตาเมื่อใช้ mock
8. ให้ backend/Node-RED รองรับ `companyId` เดียวกัน

ตัวอย่างโครงสร้างย่อ:

```ts
newco: {
  id: "newco",
  name: "New Company",
  shortName: "NC",
  accounts: [{ id: "newco_admin", label: "newco_admin" }],
  data: {
    sourceId: "newco-node-red",
    apiBaseUrl: import.meta.env.VITE_NEWCO_API_BASE_URL?.trim(),
  },
  brand: {
    kind: "image",
    text: "NC",
    logo: newCompanyLogo,
    logoAlt: "New Company Logo",
    sidebarLogoSize: 50,
    loginLogoSize: 58,
  },
  report: {
    logo: newCompanyLogo,
    logoBox: { x: 42, y: 6, width: 90, height: 62 },
  },
  mockData: { sourceStartIndex: 0, count: 8, displayNumberStart: 1 },
  theme: {
    // ใส่ token ให้ครบตาม CompanyTheme
  },
}
```

## หลักการ

- Component ใช้ `getCurrentCompany()` หรือรับ `CompanyConfig` ผ่าน props
- สีใน CSS ใช้ `--company-*` เท่านั้น
- API รับ `companyId` แล้วแยกสิทธิ์และข้อมูลฝั่ง server
- ห้ามใช้วิธีตรวจชื่อบัญชีด้วย `startsWith`, `includes` หรือ hardcode company id ในหน้า UI
- Credential จริงไม่ควรอยู่ใน registry ฝั่ง browser; `accounts` ปัจจุบันเป็นตัวเลือกสำหรับ prototype เท่านั้น
