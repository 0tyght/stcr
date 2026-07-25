# การย้าย STCR จาก Node-RED ไป Express

การย้ายครั้งนี้เปลี่ยน Runtime หลักเป็น Express และ `mqtt.js` โดยคง React, MariaDB, Schema, URL API และพฤติกรรมเดิม

เพื่อหลีกเลี่ยงการรื้อ business logic หลายพันบรรทัดในครั้งเดียว โค้ด Function เดิมถูกย้ายไป `backend/src/legacy-functions` และเรียกผ่าน compatibility runtime ของ Express ไม่มี process หรือ dependency ของ Node-RED เหลืออยู่

ก่อนแก้ Migration script จะสร้าง Git branch สำรอง `backup-before-express-*` จากนั้นติดตั้ง dependency ตรวจ Backend, Build Frontend, Commit และ Push เฉพาะเมื่อทุกขั้นผ่าน
