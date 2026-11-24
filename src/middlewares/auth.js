import jwt from 'jsonwebtoken'
import authConfig from '../config/auth.js'
import User from '../app/models/User.js'

// Situação (ativo/inativo) de cada usuário fica em cache por pouco tempo para não consultar
// o banco a cada requisição. Desativar um usuário vale em até CACHE_MS para quem já está logado
// (ou na hora, via limparCacheUsuario, chamado pela tela de Usuários).
const CACHE_MS = 30 * 1000;
const cacheAtivo = new Map(); // userId -> { ativo, expira }

export function limparCacheUsuario(userId) {
    cacheAtivo.delete(Number(userId));
}

async function usuarioAtivo(userId) {
    const agora = Date.now();
    const emCache = cacheAtivo.get(userId);
    if (emCache && emCache.expira > agora) return emCache.ativo;

    const user = await User.findByPk(userId, { attributes: ['id', 'active'] });
    const ativo = !!user && user.active !== false;
    cacheAtivo.set(userId, { ativo, expira: agora + CACHE_MS });
    return ativo;
}

async function authMiddleware(req, res, next) {
    // 1. Ignora requisições de verificação do CORS
    if (req.method === 'OPTIONS') {
        return next();
    }

    const authToken = req.headers.authorization

    if (!authToken) {
        return res.status(401).json({ error: 'Token not provided' })
    }

    const token = authToken.split(' ').at(1)

    let decoded;
    try {
        decoded = jwt.verify(token, authConfig.secret);
    } catch {
        return res.status(401).json({ error: 'token is invalid' })
    }

    try {
        // Token válido não basta: o usuário precisa existir e estar ativo.
        if (!(await usuarioAtivo(Number(decoded.id)))) {
            return res.status(401).json({ error: 'Usuário inativo. Fale com o administrador do sistema.' })
        }
    } catch (err) {
        console.error('Erro ao verificar usuário ativo:', err);
        return res.status(500).json({ error: 'Erro interno ao validar o acesso.' })
    }

    req.userId = decoded.id;
    return next()
}

export default authMiddleware
