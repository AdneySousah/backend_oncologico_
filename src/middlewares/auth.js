import jwt from 'jsonwebtoken'
import authConfig from '../config/auth.js'

function authMiddleware(req, res, next) {
    // 1. Ignora requisições de verificação do CORS
    if (req.method === 'OPTIONS') {
        return next();
    }
    
    // 2. FORÇA a liberação dessa rota pública específica
    // Se a URL contiver '/termos/paciente/', ele passa direto sem pedir token
    if (req.originalUrl.includes('/termos/paciente/')) {
        return next();
    }

    const authToken = req.headers.authorization

    if (!authToken) {
        return res.status(401).json({ error: 'Token not provided' })
    }

    const token = authToken.split(' ').at(1)

    try {
        jwt.verify(token, authConfig.secret, (err, decoded) => {
            if (err) {
                throw new Error()
            }
            req.userId = decoded.id;
        })
    }
    catch (err) {
        return res.status(401).json({ error: 'token is invalid' })
    }
    
    return next()
}

export default authMiddleware