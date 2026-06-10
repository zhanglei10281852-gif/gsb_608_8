const { Router } = require("express");
const { pool } = require("../db");
const router = Router();

router.post("/", async (req, res) => {
  const { lawyer_id, applicant_id, consult_type, content, rating } = req.body;
  if (!lawyer_id || !consult_type) {
    return res.status(400).json({ error: "律师ID、咨询类型为必填" });
  }

  try {
    const [[lawyer]] = await pool.execute(
      "SELECT id FROM lawyers WHERE id = ?",
      [lawyer_id],
    );
    if (!lawyer) return res.status(404).json({ error: "律师不存在" });

    if (applicant_id) {
      const [[applicant]] = await pool.execute(
        "SELECT id FROM applicants WHERE id = ?",
        [applicant_id],
      );
      if (!applicant) return res.status(404).json({ error: "申请人不存在" });
    }

    if (rating !== undefined && (rating < 1 || rating > 5)) {
      return res.status(400).json({ error: "评分必须为1-5分" });
    }

    const [result] = await pool.execute(
      "INSERT INTO consultations (lawyer_id, applicant_id, consult_type, content, rating) VALUES (?,?,?,?,?)",
      [
        lawyer_id,
        applicant_id || null,
        consult_type,
        content || null,
        rating || null,
      ],
    );
    res.status(201).json({ id: result.insertId, message: "咨询记录创建成功" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/", async (req, res) => {
  const {
    lawyer_id,
    applicant_id,
    consult_type,
    page = 1,
    size = 20,
  } = req.query;

  let conditions = [];
  let params = [];

  if (lawyer_id) {
    conditions.push("c.lawyer_id = ?");
    params.push(parseInt(lawyer_id));
  }
  if (applicant_id) {
    conditions.push("c.applicant_id = ?");
    params.push(parseInt(applicant_id));
  }
  if (consult_type) {
    conditions.push("c.consult_type = ?");
    params.push(consult_type);
  }

  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM consultations c${where}`,
    params,
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const [data] = await pool.query(
    `
    SELECT c.*, 
           l.name as lawyer_name, 
           a.name as applicant_name
    FROM consultations c 
    LEFT JOIN lawyers l ON c.lawyer_id = l.id
    LEFT JOIN applicants a ON c.applicant_id = a.id
    ${where} 
    ORDER BY c.created_at DESC 
    LIMIT ${limit} OFFSET ${offset}
  `,
    params,
  );

  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/:id", async (req, res) => {
  const [[row]] = await pool.query(
    `
    SELECT c.*, 
           l.name as lawyer_name, 
           a.name as applicant_name
    FROM consultations c 
    LEFT JOIN lawyers l ON c.lawyer_id = l.id
    LEFT JOIN applicants a ON c.applicant_id = a.id
    WHERE c.id = ?
  `,
    [req.params.id],
  );
  if (!row) return res.status(404).json({ error: "咨询记录不存在" });
  res.json(row);
});

router.put("/:id/rating", async (req, res) => {
  const { rating } = req.body;
  if (rating === undefined || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "评分必须为1-5分" });
  }

  const [[consultation]] = await pool.execute(
    "SELECT id FROM consultations WHERE id = ?",
    [req.params.id],
  );
  if (!consultation) return res.status(404).json({ error: "咨询记录不存在" });

  await pool.execute("UPDATE consultations SET rating = ? WHERE id = ?", [
    rating,
    req.params.id,
  ]);

  res.json({ message: "评价更新成功" });
});

module.exports = router;
