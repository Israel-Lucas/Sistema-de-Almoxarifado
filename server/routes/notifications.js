const express = require("express");
const pool = require("../database/pool");
const { requireAuth } = require("../middleware/auth");
const router = express.Router();

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT n.id,n.title,n.message,n.link,n.created_at,nr.read_at FROM notification_recipients nr JOIN notifications n ON n.id=nr.notification_id WHERE nr.user_id=$1 ORDER BY n.created_at DESC LIMIT 15`,
      [req.session.user.id],
    );
    const unread = result.rows.filter((item) => !item.read_at).length;
    res.json({ notifications: result.rows, unread });
  } catch (error) {
    next(error);
  }
});
router.post("/read-all", requireAuth, async (req, res, next) => {
  try {
    await pool.query(
      "UPDATE notification_recipients SET read_at=COALESCE(read_at,now()) WHERE user_id=$1",
      [req.session.user.id],
    );
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
