import User from '../app/models/User.js';
import Perfil from '../app/models/Perfil.js';

export default function checkPermission(modulo, acao) {
    return async (req, res, next) => {
        try {
            const user = await User.findByPk(req.userId, {
                include: [{ model: Perfil, as: 'perfil' }]
            });

            if (!user) {
                return res.status(401).json({ error: 'Usuário não encontrado.' });
            }

            // REMOVIDO O BLOCO DO is_admin QUE DAVA PASSE LIVRE AQUI!

            // Verifica se o usuário tem um perfil vinculado e se existem permissões
            if (!user.perfil || !user.perfil.permissoes) {
                return res.status(403).json({ error: 'Acesso negado. Usuário sem perfil de acesso definido.' });
            }

            const permissoes = user.perfil.permissoes;

            // Verifica se o módulo existe no JSON e se a ação específica está como true
            if (permissoes[modulo] && permissoes[modulo][acao] === true) {
                return next(); // Tudo certo, pode seguir para o Controller!
            }

            // Se chegou aqui, é porque a permissão é false ou não existe
            return res.status(403).json({ error: `Você não tem permissão para ${acao} em ${modulo}.` });

        } catch (err) {
            console.error('Erro no middleware de permissão:', err);
            return res.status(500).json({ error: 'Erro interno ao validar permissões.' });
        }
    };
}