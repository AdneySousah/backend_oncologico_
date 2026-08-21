import MonitoramentoEdicaoEmAndamento from '../models/MonitoramentoEdicaoEmAndamento.js';
import User from '../models/User.js';
import { addMinutes } from 'date-fns';

const TTL_MINUTOS = 20;

class ReservaEdicaoController {
  // Tenta reservar o paciente para edição. Se já houver reserva ativa de
  // OUTRO usuário, retorna 409 com quem está segurando. Se for do mesmo
  // usuário (reabriu a tela, ou está renovando) ou já expirou, renova.
  async reservar(req, res) {
    const { pacienteId } = req.params;
    try {
      const agora = new Date();
      const novaExpiracao = addMinutes(agora, TTL_MINUTOS);

      const reservaExistente = await MonitoramentoEdicaoEmAndamento.findOne({
        where: { paciente_id: pacienteId },
        include: [{ model: User, as: 'usuario', attributes: ['id', 'name'] }]
      });

      if (reservaExistente) {
        const aindaValida = reservaExistente.expira_em >= agora;
        if (aindaValida && reservaExistente.user_id !== req.userId) {
          return res.status(409).json({
            error: 'Paciente em atendimento por outro usuário.',
            usuario: reservaExistente.usuario?.name || 'Outro usuário',
            iniciado_em: reservaExistente.iniciado_em
          });
        }
        await reservaExistente.update({
          user_id: req.userId,
          iniciado_em: aindaValida ? reservaExistente.iniciado_em : agora,
          expira_em: novaExpiracao
        });
        return res.json({ reservado: true, expira_em: novaExpiracao });
      }

      try {
        await MonitoramentoEdicaoEmAndamento.create({
          paciente_id: pacienteId,
          user_id: req.userId,
          iniciado_em: agora,
          expira_em: novaExpiracao
        });
        return res.json({ reservado: true, expira_em: novaExpiracao });
      } catch (erroCriacao) {
        // Corrida rara: outro atendente criou a reserva entre o findOne e o create acima.
        if (erroCriacao.name === 'SequelizeUniqueConstraintError') {
          const concorrente = await MonitoramentoEdicaoEmAndamento.findOne({
            where: { paciente_id: pacienteId },
            include: [{ model: User, as: 'usuario', attributes: ['id', 'name'] }]
          });
          return res.status(409).json({
            error: 'Paciente em atendimento por outro usuário.',
            usuario: concorrente?.usuario?.name || 'Outro usuário',
            iniciado_em: concorrente?.iniciado_em
          });
        }
        throw erroCriacao;
      }
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao reservar paciente para edição.', details: error.message });
    }
  }

  // Libera a reserva — só se for o próprio usuário que a criou.
  async liberar(req, res) {
    const { pacienteId } = req.params;
    try {
      const reserva = await MonitoramentoEdicaoEmAndamento.findOne({ where: { paciente_id: pacienteId } });
      if (reserva && reserva.user_id === req.userId) {
        await reserva.destroy();
      }
      return res.json({ liberado: true });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao liberar reserva.', details: error.message });
    }
  }
}

export default new ReservaEdicaoController();