// Limite simples de tentativas (em memória, sem dependência externa) para login e
// recuperação de senha. Conta por rota + e-mail/usuário informado (e, sem e-mail, pelo IP):
// contar só por IP travaria todos os usuários atrás do mesmo proxy.
//
// Em memória vale para uma instância do backend; se um dia rodar mais de uma, troque por
// um armazenamento compartilhado.
const contadores = new Map(); // chave -> { tentativas, expira }

function ipDa(req) {
    const encaminhado = req.headers['x-forwarded-for'];
    return (encaminhado ? String(encaminhado).split(',')[0] : req.socket?.remoteAddress || '').trim();
}

export default function limiteTentativas({ maximo, janelaMinutos, mensagem }) {
    const janelaMs = janelaMinutos * 60 * 1000;

    return (req, res, next) => {
        const identificador = String(req.body?.email || req.body?.username || '').trim().toLowerCase() || `ip:${ipDa(req)}`;
        const chave = `${req.path}|${identificador}`;
        const agora = Date.now();

        let registro = contadores.get(chave);
        if (!registro || registro.expira <= agora) {
            registro = { tentativas: 0, expira: agora + janelaMs };
            contadores.set(chave, registro);
        }
        registro.tentativas += 1;

        if (registro.tentativas > maximo) {
            const minutos = Math.ceil((registro.expira - agora) / 60000);
            res.set('Retry-After', String(Math.ceil((registro.expira - agora) / 1000)));
            return res.status(429).json({ error: mensagem || `Muitas tentativas. Tente novamente em ${minutos} minuto(s).` });
        }

        // limpeza ocasional para o Map não crescer sem fim
        if (contadores.size > 5000) {
            for (const [k, v] of contadores) if (v.expira <= agora) contadores.delete(k);
        }
        return next();
    };
}
