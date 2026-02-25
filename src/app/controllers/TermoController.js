import Pacientes from '../models/Pacientes.js';
import User from '../models/User.js';
import { enviarMensagemWhatsApp } from '../../services/whatsapp.js';

class TermoController {
    // Disparado pelo usuário do sistema (Médico/Atendente)
    async sendLink(req, res) {
        const { paciente_id } = req.body;

        try {
            // Pega o usuário logado usando o ID injetado pelo authMiddleware
            const user = await User.findByPk(req.userId);
            const paciente = await Pacientes.findByPk(paciente_id);

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const numeroDestino = paciente.celular || paciente.telefone;
            
            if (!numeroDestino) {
                return res.status(400).json({ error: 'Paciente não possui número cadastrado' });
            }

            // URL do seu Front-End. Em dev geralmente é http://localhost:3000
           const frontUrl = process.env.FRONT_URL || 'http://localhost:3000';
            const linkAcompanhamento = `${frontUrl}/paciente/termo/${paciente.id}`;

            const mensagem = `Olá ${paciente.nome}, meu nome é ${user.name}, estou entrando em contato em nome da CIC Oncologia.\n\nAceita os termos de contato via telefone para te acompanhar no seu tratamento?\n\nPor favor, acesse o link abaixo para responder:\n${linkAcompanhamento}`;

            const enviado = await enviarMensagemWhatsApp(numeroDestino, mensagem);

            if (!enviado) {
                return res.status(500).json({ error: 'Falha ao enviar mensagem via WhatsApp' });
            }

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
        const {id} = req.params
        try {
            const paciente = await Pacientes.findByPk(id, { attributes: ['id', 'status_termo'] });
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }
            return res.json({ paciente});
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao checar status' });
        }
    }
}

export default new TermoController();