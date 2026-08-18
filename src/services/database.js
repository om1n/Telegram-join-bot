export async function cleanupDuplicates(db) {
    await db.prepare(`
    UPDATE requests
    SET status = 'superseded'
    WHERE status = 'pending'
    AND id NOT IN (
      SELECT MAX(id)
      FROM requests
      WHERE status = 'pending'
      GROUP BY user_id, chat_id
    )
  `).run();
}
