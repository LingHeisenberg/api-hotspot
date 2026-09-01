import { Router } from 'express';
import {
  getFreeTrialStatus,
  startFreeTrial
} from '../services/freeTrialService.js';

const router = Router();

router.get('/status', async (req, res, next) => {
  try {
    const status = await getFreeTrialStatus(req.query);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

router.post('/start', async (req, res, next) => {
  try {
    const trial = await startFreeTrial(req.body);
    res.status(201).json(trial);
  } catch (error) {
    next(error);
  }
});

export default router;
