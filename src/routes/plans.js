import { Router } from 'express';
import { pool } from '../config/db.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const [plans] = await pool.execute(
      `SELECT id, nome, tempo, preco, categoria, perfil_mikrotik
       FROM pacotes
       WHERE ativo = 1
       ORDER BY ordem ASC, id ASC`
    );

    res.json({ plans });
  } catch (error) {
    next(error);
  }
});

export default router;
