import Pacientes from '../models/Pacientes.js';
import NpsResponse from '../models/NpsResponse.js';
import { Op } from 'sequelize';
import AuditService from '../../services/AuditService.js';
import { enviarEnqueteNPS } from '../../services/whatsapp.js';

class NpsController {
    /**
     * 1. DISPARO DO NPS (Chamado pelo sistema/atendente)
     */
    async sendNps(req, res) {
        // Recebe também a intenção de quem é o destinatário
        const { paciente_id, telefone_destino, destino_tipo } = req.body;

        try {
            const paciente = await Pacientes.findByPk(paciente_id,{
                include: ['operadoras']
            });

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const numeroDestino = telefone_destino || paciente.celular || paciente.telefone;
            
            if (!numeroDestino) {
                return res.status(400).json({ error: 'Paciente/Cuidador não possui número cadastrado' });
            }

            // Dispara via Twilio Service
            const enviado = await enviarEnqueteNPS(numeroDestino, paciente.nome, paciente.operadoras.nome, req.userId);

            if (!enviado) {
                return res.status(500).json({ error: 'Falha ao enviar NPS via Twilio' });
            }

            // ---------------------------------------------
            // LÓGICA DO LOG DETALHADO
            // ---------------------------------------------
            const nomeDestinoFinal = destino_tipo === 'cuidador' && paciente.nome_cuidador 
                                    ? paciente.nome_cuidador 
                                    : paciente.nome;
            const papelDestino = destino_tipo === 'cuidador' ? 'Cuidador/Responsável' : 'Paciente';

            const mensagemLog = `Disparou a pesquisa NPS (Satisfação) via WhatsApp para o(a) ${papelDestino} (${nomeDestinoFinal}) no número ${numeroDestino}.`;

            await AuditService.log(
                req.userId, 
                'Envio', 
                'NPS WhatsApp', 
                paciente.id, 
                mensagemLog
            );
            
            return res.json({ message: 'Pesquisa de NPS enviada com sucesso!' });

        } catch (error) {
            console.error("Erro ao enviar NPS:", error);
            return res.status(500).json({ error: 'Erro interno no servidor' });
        }
    }

   async registerResponse(req, res) {
    const { From, Body } = req.body; 

    try {
        if (!From) {
            return res.status(200).send('<Response></Response>');
        }
        const stringFrom = String(From);
        const celularLimpo = stringFrom.replace('whatsapp:', '').replace(/\D/g, '');

        const stringBody = Body ? String(Body) : '';
        const match = stringBody.match(/\b(10|[0-9])\b/);
        
        if (!match) {
            console.warn(`⚠️ Resposta de ${celularLimpo} sem nota válida: "${Body}"`);
            res.set('Content-Type', 'text/xml');
            return res.status(200).send('<Response></Response>');
        }

        const notaFinal = parseInt(match[0]);

        const ultimos8 = celularLimpo.slice(-8);
        const paciente = await Pacientes.findOne({
            where: {
                celular: { [Op.like]: `%${ultimos8}` }
            }
        });

        if (!paciente) {
            console.error(`❌ Voto de ${celularLimpo} ignorado: Paciente não localizado.`);
            res.set('Content-Type', 'text/xml');
            return res.status(200).send('<Response></Response>');
        }

        await NpsResponse.create({
            paciente_id: paciente.id,
            nota: notaFinal
        });

        console.log(`✅ NPS Registrado: ${paciente.nome} deu nota ${notaFinal}`);

        res.set('Content-Type', 'text/xml');
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
            <Response>
                <Message>A ${paciente.operadoras.nome} agradece o seu feedback! Sua nota ${notaFinal} foi registrada com sucesso.</Message>
            </Response>`);

    } catch (error) {
        console.error("❌ Erro crítico no Webhook da Twilio:", error);
        res.set('Content-Type', 'text/xml');
        return res.status(200).send('<Response></Response>');
    }
  }

    /**
     * 3. RELATÓRIO DE NPS (Dashboard)
     */
    async index(req, res) {
        try {
            const npsData = await NpsResponse.findAll({
                attributes: ['id', 'paciente_id', 'nota', 'created_at'],
                order: [['created_at', 'DESC']]
            });

            const total = npsData.length;
            if (total === 0) return res.json({ resumo: { total_respostas: 0 }, dados: [] });

            let promotores = 0;
            let detratores = 0;
            let somaNotas = 0;

            npsData.forEach(resp => {
                somaNotas += resp.nota;
                if (resp.nota >= 9) promotores++;
                else if (resp.nota <= 6) detratores++;
            });

            const scoreNps = Math.round(((promotores - detratores) / total) * 100);
            const mediaReal = (somaNotas / total).toFixed(1);

            return res.json({
                resumo: { 
                    total_respostas: total, 
                    score_nps: scoreNps, 
                    media_real: Number(mediaReal)
                },
                dados: npsData 
            });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao buscar dados do NPS' });
        }
    }

    /**
     * 4. VERIFICAÇÃO DE DUPLICIDADE (Evita o paciente votar 10x seguidas)
     */
    async checkPatientStatus(req, res) {
        const { id } = req.params;
        
        const limiteTempo = new Date();
        limiteTempo.setMinutes(limiteTempo.getMinutes() - 2); 

        try {
            const nps = await NpsResponse.findOne({
                where: {
                    paciente_id: id,
                    created_at: { [Op.gte]: limiteTempo } 
                },
                order: [['created_at', 'DESC']]
            });

            return res.json({ 
                respondido: !!nps, 
                nota: nps ? nps.nota : null 
            });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao verificar status' });
        }
    }
}
export default new NpsController();