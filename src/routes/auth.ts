import express from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { authenticateToken, AuthedRequest } from "../middleware/auth.js";

const router = express.Router();

/**
 * Rate limiter ESTRÍCTO solo para /api/login
 * Evita brute-force: máx 5 intentos cada 15 minutos por IP
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Demasiados intentos de login. Intenta en 15 minutos." },
});

// Validación con Zod (nunca confíes en el frontend)
const loginSchema = z.object({
  user: z.string().min(1, "Usuario requerido").max(100),
  password: z.string().min(1, "Contraseña requerida").max(200),
});

/**
 * POST /api/login
 * Body: { user, password }
 * Respuesta OK: { ok: true, token, expiresIn }
 * Respuesta FAIL: 401 { ok:false, error }
 *
 * Credenciales configurables por .env:
 *   DASHBOARD_USER, DASHBOARD_PASSWORD
 * Fallback solo para dev si no están definidas.
 */
router.post("/login", loginLimiter, (req, res) => {
  // 1. Validación de entrada parametrizada
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: "Datos inválidos",
      details: parsed.error.flatten(),
    });
  }

  const { user, password } = parsed.data;

  const expectedUser = process.env.DASHBOARD_USER || "admin";
  const expectedPass = process.env.DASHBOARD_PASSWORD || "admin123";

  if (!process.env.JWT_SECRET) {
    console.error("[auth] JWT_SECRET no definido - usando fallback inseguro");
  }
  const jwtSecret = process.env.JWT_SECRET || "dev_secret_cambiar_en_produccion";
  const expiresIn = process.env.JWT_EXPIRES_IN || "12h";

  // 2. Comparación en tiempo constante no es crítica aquí (un solo usuario), pero no loguear password
  if (user !== expectedUser || password !== expectedPass) {
    return res.status(401).json({ ok: false, error: "Credenciales inválidas" });
  }

  // 3. Firmar JWT - payload mínimo
  const token = jwt.sign({ user: expectedUser }, jwtSecret, { expiresIn } as jwt.SignOptions);

  return res.json({
    ok: true,
    token,
    expiresIn,
    user: expectedUser,
  });
});

/**
 * GET /api/verify - Ruta de ejemplo protegida para validar token desde el Dashboard
 * Header: Authorization: Bearer <token>
 */
router.get("/verify", authenticateToken, (req: AuthedRequest, res) => {
  res.json({ ok: true, user: req.user });
});

export default router;
