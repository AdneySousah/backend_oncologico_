import Pacientes from '../models/Pacientes.js';
import User from '../models/User.js';
import { enviarMensagemWhatsApp } from '../../services/whatsapp.js';
import AuditService from '../../services/AuditService.js';

class TermoController {
    // Disparado pelo usuário do sistema (Médico/Atendente)
    async sendLink(req, res) {
        // Recebe também a intenção: se é paciente ou cuidador
        const { paciente_id, telefone_destino, destino_tipo } = req.body;

        try {
            const user = await User.findByPk(req.userId);
            const paciente = await Pacientes.findByPk(paciente_id);

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const numeroDestino = telefone_destino || paciente.celular || paciente.telefone;

            if (!numeroDestino) {
                return res.status(400).json({ error: 'Nenhum número de destino informado ou cadastrado.' });
            }

            paciente.status_termo = 'Pendente';
            await paciente.save();

            const frontUrl = process.env.FRONT_URL || 'http://localhost:3000';
            const linkAcompanhamento = `${frontUrl}/paciente/termo/${paciente.id}`;

            const enviado = await enviarMensagemWhatsApp(
                numeroDestino,
                paciente.nome,
                user.name,
                linkAcompanhamento,
                req.userId
            );

            if (!enviado) {
                return res.status(500).json({ error: 'Falha ao enviar mensagem via WhatsApp' });
            }

            // ---------------------------------------------
            // LÓGICA DO LOG DETALHADO E IMPECÁVEL AQUI
            // ---------------------------------------------
            const nomeDestinoFinal = destino_tipo === 'cuidador' && paciente.nome_cuidador 
                                    ? paciente.nome_cuidador 
                                    : paciente.nome;
            const papelDestino = destino_tipo === 'cuidador' ? 'Cuidador/Responsável' : 'Paciente';

            const mensagemLog = `Disparou o termo de acompanhamento para o(a) ${papelDestino} (${nomeDestinoFinal}) no número ${numeroDestino}.`;

            // O seu AuditService.log() sendo chamado perfeitamente como você idealizou:
            await AuditService.log(
                req.userId, 
                'Envio', 
                'Termo WhatsApp', 
                paciente.id, 
                mensagemLog
            );

            return res.json({ message: 'Link enviado com sucesso!' });

        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro interno no servidor' });
        }
    }

    // Acessado publicamente pelo paciente clicando no link
    async answerTerm(req, res) {
        const { id } = req.params;
        const { aceite } = req.body; // boolean

        try {
            const paciente = await Pacientes.findByPk(id);

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            paciente.status_termo = aceite ? 'Aceito' : 'Recusado';
            await paciente.save();

            return res.json({ message: 'Resposta registrada com sucesso', status_termo: paciente.status_termo });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao processar resposta' });
        }
    }

    // Método para o frontend consultar o status em tempo real (Polling)
    async checkStatus(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id, { attributes: ['id', 'status_termo'] });
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }
            return res.json({ status_termo: paciente.status_termo });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao checar status' });
        }
    }

    async verifyResponse(req, res) {
        const { id } = req.params
        try {
            const paciente = await Pacientes.findByPk(id, { attributes: ['id', 'status_termo'] });
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }
            return res.json({ paciente });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao checar status' });
        }
    }
}

export default new TermoController();