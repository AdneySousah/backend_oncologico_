import Pacientes from '../models/Pacientes.js';
import NpsResponse from '../models/NpsResponse.js';
import { Op } from 'sequelize';
import User from '../models/User.js';
import AuditService from '../../services/AuditService.js';
import { enviarEnqueteNPS } from '../../services/whatsapp.js'; // Vamos criar essa função no passo 4

class NpsController {
    // 1. Envia o NPS (Requer Autenticação)
    async sendNps(req, res) {
        const { paciente_id } = req.body;

        try {
            const paciente = await Pacientes.findByPk(paciente_id);

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const numeroDestino = paciente.celular || paciente.telefone;
            
            if (!numeroDestino) {
                return res.status(400).json({ error: 'Paciente não possui número cadastrado' });
            }

            // Dispara a função que cria a enquete no whatsapp-web.js
            const enviado = await enviarEnqueteNPS(numeroDestino, paciente.nome);

            if (!enviado) {
                return res.status(500).json({ error: 'Falha ao enviar NPS via WhatsApp' });
            }

            await AuditService.log(req.userId, 'Envio', 'NPS WhatsApp', paciente.id, `Enviou pesquisa de NPS via WhatsApp para o número ${numeroDestino}`);
            
            return res.json({ message: 'Pesquisa de NPS enviada com sucesso!' });

        } catch (error) {
            console.error("Erro ao enviar NPS:", error);
            return res.status(500).json({ error: 'Erro interno no servidor' });
        }
    }

    // 2. Recebe a nota (Rota Pública, chamada pelo bot do WhatsApp)
    async registerResponse(req, res) {
        const { celular, nota } = req.body;

        try {
            const celularLimpo = celular.replace(/\D/g, ''); // Ex: 553197334935

            // Tira o DDI (55) pra gente trabalhar só com DDD e número
            let numeroSemDDI = celularLimpo.startsWith('55') ? celularLimpo.substring(2) : celularLimpo;

            // Extrai o DDD e obriga a ler só os últimos 8 dígitos (ignora o nono dígito)
            const ddd = numeroSemDDI.substring(0, 2);
            const ultimos8 = numeroSemDDI.slice(-8); 
            const prefixo = ultimos8.substring(0, 4);
            const sufixo = ultimos8.substring(4, 8);

            // Busca coringa: Aceita "(31) 99733-4935", "3197334935", etc.
            let paciente = await Pacientes.findOne({
                where: {
                    celular: {
                        [Op.like]: `%${ddd}%${prefixo}%${sufixo}%`
                    }
                }
            });

            if (!paciente) {
                console.warn(`⚠️ Voto recebido de ${celular}, mas paciente não encontrado no banco com a busca inteligente.`);
                return res.status(404).json({ error: 'Paciente não encontrado para este número' });
            }

            // Salva a nota
            await NpsResponse.create({
                paciente_id: paciente.id,
                nota: Number(nota)
            });

            return res.json({ message: 'Nota de NPS registrada com sucesso!' });

        } catch (error) {
            console.error("❌ Erro ao registrar nota do NPS:", error);
            return res.status(500).json({ error: 'Erro ao processar resposta do NPS' });
        }
    }

    // 3. Exibe o relatório (Requer Autenticação)
    async index(req, res) {
        try {
            const npsData = await NpsResponse.findAll({
                attributes: ['id', 'nota', 'created_at'],
                // Excluindo o ID do paciente da resposta para manter o anonimato como você pediu
                // Trazemos apenas o id da resposta, a nota e a data
                order: [['created_at', 'DESC']]
            });

            // Lógica rápida para calcular a média e a pontuação do NPS
            const total = npsData.length;
            let promotores = 0; // Notas 9 e 10
            let detratores = 0; // Notas de 0 a 6

            npsData.forEach(resp => {
                if (resp.nota >= 9) promotores++;
                else if (resp.nota <= 6) detratores++;
            });

            const score = total > 0 ? Math.round(((promotores - detratores) / total) * 100) : 0;

            return res.json({
                resumo: { total_respostas: total, score_nps: score },
                dados: npsData
            });

        } catch (error) {
            console.error("Erro ao listar NPS:", error);
            return res.status(500).json({ error: 'Erro ao buscar dados do NPS' });
        }
    }

    async checkPatientStatus(req, res) {
    const { id } = req.params; // ID do paciente
    
    // Procura uma resposta dada por este paciente na última 1 hora
    const limiteTempo = new Date();
    limiteTempo.setHours(limiteTempo.getHours() - 1);

    try {
        const nps = await NpsResponse.findOne({
            where: {
                paciente_id: id,
                created_at: { [Op.gte]: limiteTempo }
            },
            order: [['created_at', 'DESC']]
        });

        if (nps) {
            return res.json({ respondido: true, nota: nps.nota });
        }
        
        return res.json({ respondido: false });
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao verificar status' });
    }
}
}

export default new NpsController();