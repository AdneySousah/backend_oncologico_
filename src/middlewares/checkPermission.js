import User from '../app/models/User.js';
import Perfil from '../app/models/Perfil.js';

// checkPermission('telemonitoramento', 'editar')            -> exige esse módulo
// checkPermission(['avaliacoes', 'telemonitoramento'], 'acessar') -> basta UM dos módulos
// (para rotas usadas por mais de uma tela).
export default function checkPermission(modulo, acao) {
    const modulos = Array.isArray(modulo) ? modulo : [modulo];

    return async (req, res, next) => {
        try {
            const user = await User.findByPk(req.userId, {
                include: [{ model: Perfil, as: 'perfil' }]
            });

            if (!user) {
                return res.status(401).json({ error: 'Usuário não encontrado.' });
            }

            // Verifica se o usuário tem um perfil vinculado e se existem permissões
            if (!user.perfil || !user.perfil.permissoes) {
                return res.status(403).json({ error: 'Acesso negado. Usuário sem perfil de acesso definido.' });
            }

            const permissoes = user.perfil.permissoes;

            // Basta um dos módulos ter a ação marcada como true
            if (modulos.some((m) => permissoes[m] && permissoes[m][acao] === true)) {
                return next();
            }

            return res.status(403).json({ error: `Você não tem permissão para ${acao} em ${modulos.join(' / ')}.` });

        } catch (err) {
            console.error('Erro no middleware de permissão:', err);
            return res.status(500).json({ error: 'Erro interno ao validar permissões.' });
        }
    };
}
