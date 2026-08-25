import mysql from 'mysql2/promise';
import { env } from './env.js';

export const pool = mysql.createPool(env.db);
