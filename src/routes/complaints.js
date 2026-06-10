const { Router } = require("express");
const { pool } = require("../db");
const router = Router();

router.post("/", async (req, res) => {
  const { case_id, lawyer_id, applicant_id, content } = req.body;
  if (!case_id || !lawyer_id || !applicant_id || !content) {
    return res
      .status(400)
      .json({ error: "案件ID、律师ID、申请人ID、投诉内容为必填" });
  }

  try {
    const [[caseRow]] = await pool.execute(
      "SELECT id FROM cases WHERE id = ?",
      [case_id],
    );
    if (!caseRow) return res.status(404).json({ error: "案件不存在" });

    const [[lawyer]] = await pool.execute(
      "SELECT id FROM lawyers WHERE id = ?",
      [lawyer_id],
    );
    if (!lawyer) return res.status(404).json({ error: "律师不存在" });

    const [[applicant]] = await pool.execute(
      "SELECT id FROM applicants WHERE id = ?",
      [applicant_id],
    );
    if (!applicant) return res.status(404).json({ error: "申请人不存在" });

    const [result] = await pool.execute(
      "INSERT INTO complaints (case_id, lawyer_id, applicant_id, content) VALUES (?,?,?,?)",
      [case_id, lawyer_id, applicant_id, content],
    );
    res.status(201).json({ id: result.insertId, message: "投诉提交成功" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/", async (req, res) => {
  const {
    status,
    lawyer_id,
    applicant_id,
    case_id,
    page = 1,
    size = 20,
  } = req.query;

  let conditions = [];
  let params = [];

  if (status) {
    conditions.push("c.status = ?");
    params.push(status);
  }
  if (lawyer_id) {
    conditions.push("c.lawyer_id = ?");
    params.push(parseInt(lawyer_id));
  }
  if (applicant_id) {
    conditions.push("c.applicant_id = ?");
    params.push(parseInt(applicant_id));
  }
  if (case_id) {
    conditions.push("c.case_id = ?");
    params.push(parseInt(case_id));
  }

  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM complaints c${where}`,
    params,
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const [data] = await pool.query(
    `
    SELECT c.*, 
           l.name as lawyer_name, 
           a.name as applicant_name,
           cs.case_no
    FROM complaints c 
    LEFT JOIN lawyers l ON c.lawyer_id = l.id
    LEFT JOIN applicants a ON c.applicant_id = a.id
    LEFT JOIN cases cs ON c.case_id = cs.id
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
           a.name as applicant_name,
           cs.case_no
    FROM complaints c 
    LEFT JOIN lawyers l ON c.lawyer_id = l.id
    LEFT JOIN applicants a ON c.applicant_id = a.id
    LEFT JOIN cases cs ON c.case_id = cs.id
    WHERE c.id = ?
  `,
    [req.params.id],
  );
  if (!row) return res.status(404).json({ error: "投诉记录不存在" });
  res.json(row);
});

router.put("/:id/handle", async (req, res) => {
  const { result } = req.body;
  if (!result) return res.status(400).json({ error: "处理结果为必填" });

  const [[complaint]] = await pool.execute(
    "SELECT * FROM complaints WHERE id = ?",
    [req.params.id],
  );
  if (!complaint) return res.status(404).json({ error: "投诉记录不存在" });
  if (complaint.status !== "待处理") {
    return res.status(400).json({ error: "只有待处理状态可以处理" });
  }

  await pool.execute(
    "UPDATE complaints SET status = '已处理', result = ? WHERE id = ?",
    [result, req.params.id],
  );

  res.json({ message: "投诉已处理" });
});

router.put("/:id/cancel", async (req, res) => {
  const [[complaint]] = await pool.execute(
    "SELECT * FROM complaints WHERE id = ?",
    [req.params.id],
  );
  if (!complaint) return res.status(404).json({ error: "投诉记录不存在" });
  if (complaint.status !== "待处理") {
    return res.status(400).json({ error: "只有待处理状态可以撤销" });
  }

  await pool.execute("UPDATE complaints SET status = '已撤销' WHERE id = ?", [
    req.params.id,
  ]);

  res.json({ message: "投诉已撤销" });
});

module.exports = router;
