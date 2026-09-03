import Pacientes from '../models/Pacientes.js';
import NpsResponse from '../models/NpsResponse.js';
import AuditService from '../../services/AuditService.js';
import { enviarLinkNPS } from '../../services/whatsapp.js';
import Mail from '../../services/Mail.js';

class NpsController {
    /**
     * 1. DISPARO DO NPS (Chamado pelo sistema/atendente)
     */
    async sendNps(req, res) {
        const { paciente_id, telefone_destino, destino_tipo, monitoramento_id, email_destino } = req.body;

        try {
            const paciente = await Pacientes.findByPk(paciente_id, {
                include: ['operadoras']
            });

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            if (paciente.tratamento_pausado) {
                return res.status(400).json({ error: 'Este paciente está com o tratamento pausado. Retome o tratamento antes de enviar a pesquisa de NPS.' });
            }

            // Geração do Link Front-end
            const frontUrl = process.env.FRONT_URL || 'http://localhost:3000';
            const linkNps = `${frontUrl}/paciente/nps/${paciente.id}/${monitoramento_id}`;

            // ==========================================
            // FLUXO: GERAR LINK PRA COPIAR (envio 100% manual, sem
            // disparar nada automaticamente).
            // ==========================================
            if (destino_tipo === 'copiar_link') {
                await AuditService.log(
                    req.userId,
                    'Envio',
                    'NPS Link Manual',
                    paciente.id,
                    `Gerou o link da pesquisa NPS para envio manual (nenhum disparo automático foi feito).`
                );

                return res.json({ message: 'Link gerado com sucesso!', link: linkNps });
            }

            // ==========================================
            // FLUXO DE DISPARO POR E-MAIL
            // ==========================================
            if (destino_tipo === 'email') {
                if (!email_destino) {
                    return res.status(400).json({ error: 'E-mail não informado.' });
                }

                if (paciente.email !== email_destino) {
                    paciente.email = email_destino;
                    await paciente.save();
                }

                const operadoraNome = paciente.operadoras?.nome || 'nossa equipe de saúde';

                const htmlContent = `
                    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                        <h2>Olá, ${paciente.nome}!</h2>
                        <p>Estamos entrando em contato em nome da <strong>${operadoraNome}</strong>.</p>
                        <p>Gostaríamos de saber sua opinião sobre o atendimento que você recebeu.</p>
                        <p>Por favor, acesse o link abaixo para avaliar:</p>
                        <div style="margin: 20px 0;">
                            <a href="${linkNps}" style="background-color: #0056b3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                                Avaliar Atendimento
                            </a>
                        </div>
                        <p>Se o botão não funcionar, copie e cole este link no seu navegador:</p>
                        <p><a href="${linkNps}">${linkNps}</a></p>
                        <p>Agradecemos a sua atenção!</p>
                    </div>
                `;

                await Mail.sendMail({
                    to: email_destino,
                    subject: 'Pesquisa de Satisfação',
                    html: htmlContent
                });

                await AuditService.log(
                    req.userId,
                    'Envio',
                    'NPS E-mail',
                    paciente.id,
                    `Disparou a pesquisa NPS por e-mail para ${email_destino}.`
                );

                return res.json({ message: 'Link de pesquisa de NPS enviado por e-mail com sucesso!' });
            }

            // ==========================================
            // FLUXO DE DISPARO VIA WHATSAPP (Twilio)
            // ==========================================
            const numeroDestino = telefone_destino || paciente.celular || paciente.telefone;

            if (!numeroDestino) {
                return res.status(400).json({ error: 'Paciente/Cuidador não possui número cadastrado' });
            }

            // Dispara via Twilio usando uma mensagem de texto com o link
            const enviado = await enviarLinkNPS(
                numeroDestino,
                paciente.nome,
                paciente.operadoras.nome,
                req.userId,
                linkNps // Passando a URL construída
            );

            if (!enviado) {
                return res.status(500).json({ error: 'Falha ao enviar NPS via Twilio' });
            }

            // Lógica de log mantida
            const nomeDestinoFinal = destino_tipo === 'cuidador' && paciente.nome_cuidador
                ? paciente.nome_cuidador
                : paciente.nome;
            const papelDestino = destino_tipo === 'cuidador' ? 'Cuidador/Responsável' : 'Paciente';

            const mensagemLog = `Disparou o link da pesquisa NPS via WhatsApp para o(a) ${papelDestino} (${nomeDestinoFinal}) no número ${numeroDestino}.`;

            await AuditService.log(
                req.userId,
                'Envio',
                'NPS WhatsApp',
                paciente.id,
                mensagemLog
            );

            return res.json({ message: 'Link de pesquisa de NPS enviado com sucesso!' });

        } catch (error) {
            console.error("Erro ao enviar NPS:", error);
            return res.status(500).json({ error: 'Erro interno no servidor' });
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
        const { id, monitoramento_id } = req.params;

        const limiteTempo = new Date();
        limiteTempo.setMinutes(limiteTempo.getMinutes() - 2);

       try {
            // Procura se tem NPS para aquele monitoramento específico
            const nps = await NpsResponse.findOne({
                where: {
                    paciente_id: id,
                    monitoramento_id: monitoramento_id
                }
            });

            return res.json({ 
                respondido: !!nps, 
                nota: nps ? nps.nota : null 
            });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao verificar status' });
        }
    }

    async answerNps(req, res) {
        const { paciente_id, monitoramento_id } = req.params;
        const { nota } = req.body;

        try {
            // ✅ CORRIGIDO: Usando paciente_id no lugar de id
            const paciente = await Pacientes.findByPk(paciente_id);

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const notaFinal = parseInt(nota);

            if (isNaN(notaFinal) || notaFinal < 0 || notaFinal > 10) {
                return res.status(400).json({ error: 'Nota inválida fornecida' });
            }

            await NpsResponse.create({
                paciente_id: paciente_id,
                monitoramento_id: monitoramento_id,
                nota: notaFinal // ✅ CORRIGIDO: Reaproveitando a variável já convertida
            });

            return res.json({ message: 'Agradecemos o seu feedback! Sua nota foi registrada com sucesso.' });

        } catch (error) {
            console.error("Erro ao registrar NPS via link:", error);
            return res.status(500).json({ error: 'Erro ao processar resposta' });
        }
    }

    /**
     * ROTA PÚBLICA: Valida o paciente para a tela de NPS externa
     */
    async verifyNpsPatient(req, res) {
        const { paciente_id, monitoramento_id } = req.params;

        try {
            const paciente = await Pacientes.findByPk(paciente_id, {
                attributes: ['id', 'nome', 'sobrenome']
            });

            if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });

            // Verifica se JÁ EXISTE uma nota para ESTE monitoramento específico
            const npsExistente = await NpsResponse.findOne({
                where: {
                    paciente_id: paciente_id,
                    monitoramento_id: monitoramento_id // Exige coluna monitoramento_id no banco
                }
            });

            return res.json({
                paciente,
                ja_respondeu: !!npsExistente // Bloqueia apenas se este atendimento já foi avaliado
            });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao verificar paciente' });
        }
    }

    /**
     * INSERÇÃO MANUAL DE NPS (Atendente insere a nota relatada pelo paciente/cuidador)
     */
    async manualSubmit(req, res) {
        const { paciente_id, monitoramento_id, nota, destino_tipo } = req.body;

        try {
            const paciente = await Pacientes.findByPk(paciente_id);

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const notaFinal = parseInt(nota);

            if (isNaN(notaFinal) || notaFinal < 0 || notaFinal > 10) {
                return res.status(400).json({ error: 'Nota inválida fornecida' });
            }

            // Registra a nota no banco
            await NpsResponse.create({
                paciente_id: paciente_id,
                monitoramento_id: monitoramento_id,
                nota: notaFinal
            });

            // Registra a ação no log de auditoria
            const papelDestino = destino_tipo === 'cuidador' ? 'Cuidador/Responsável' : 'Paciente';
            const mensagemLog = `Inseriu manualmente a nota NPS (${notaFinal}) referente ao ${papelDestino}.`;

            await AuditService.log(
                req.userId,
                'Inserção Manual',
                'NPS',
                paciente.id,
                mensagemLog
            );

            return res.json({ message: 'Nota registrada manualmente com sucesso!' });

        } catch (error) {
            console.error("Erro ao registrar NPS manual:", error);
            return res.status(500).json({ error: 'Erro interno ao salvar nota manual' });
        }
    }
}
export default new NpsController();