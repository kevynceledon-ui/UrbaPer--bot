import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthedRequest extends Request {
  user?: string | jwt.JwtPayload;
}

/**
 * Middleware para proteger rutas HTTP con JWT (Bearer token).
 * Header esperado: Authorization: Bearer <token>
 */
function authenticateToken(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader; // permite token sin Bearer por flexibilidad

  if (!token) {
    return res.status(401).json({ ok: false, error: "No autorizado: token no proporcionado" });
  }

  if (!process.env.JWT_SECRET) {
    console.error("[auth] JWT_SECRET no definido");
    return res.status(500).json({ ok: false, error: "Error de configuración del servidor" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(403).json({ ok: false, error: "Token inválido o expirado" });
  }
}

export { authenticateToken };
