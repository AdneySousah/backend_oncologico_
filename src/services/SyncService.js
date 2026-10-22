import Pacientes from '../app/models/Pacientes.js';
import Operadora from '../app/models/Operadora.js';
import Medicamentos from '../app/models/Medicamentos.js';
import EventosPaciente from '../app/models/EventosPaciente.js';
import AuditService from './AuditService.js';
import { Op } from 'sequelize';

const formatarCelularWhatsapp = (numero) => {
    if (!numero) return null;
    let limpo = String(numero).replace(/\D/g, '');
    if (limpo.length === 11 && !limpo.startsWith('55')) limpo = '55' + limpo;
    return limpo;
};


const OFFSET_BRASILIA_MS = 3 * 60 * 60 * 1000;

// Nova função para garantir que o corte da data respeite o fuso do Brasil (-03:00)
const extrairDataBrasil = (dataIso) => {
    if (!dataIso) return null;
    // Se já vier só a data (ex: "2026-06-30", sem horário), não há fuso a corrigir.
    if (typeof dataIso === 'string' && dataIso.length === 10 && !dataIso.includes('T')) {
        return dataIso;
    }
    try {
        const dataUtc = new Date(dataIso);
        if (isNaN(dataUtc.getTime())) return null;
        const dataBrasil = new Date(dataUtc.getTime() - OFFSET_BRASILIA_MS);
        const ano = dataBrasil.getUTCFullYear();
        const mes = String(dataBrasil.getUTCMonth() + 1).padStart(2, '0');
        const dia = String(dataBrasil.getUTCDate()).padStart(2, '0');
        return `${ano}-${mes}-${dia}`;
    } catch (error) {
        return null;
    }
};

class PacienteSyncService {
    async syncPacientes(pacientesExternos, userId) {
        const successes = [];
        const errors = [];
        // 👇 Em vez de 1 log de auditoria por paciente sincronizado (o que
        // gerava 200+ linhas idênticas a cada rodada, numa base de ~200
        // pacientes), acumula os números e grava só 1 evento resumido no
        // final da sincronização inteira.
        let pacientesAtualizadosCount = 0;
        let pacientesCriadosCount = 0;
        // 👇 NOVO: eventos JÁ processados pelo telemonitoramento cujas datas
        // foram adiadas no sistema externo (reaproveitamento da programação
        // pra outra compra, em vez de criar evento novo). Não dá pra tratar
        // como compra nova — o id já está num ciclo — então fica na
        // auditoria pra alguém conferir.
        const reprogramadosProcessados = [];
        // 👇 NOVO: eventos que deixaram de existir no sistema externo (excluídos
        // lá). O externo não manda marca de exclusão — o evento só some da
        // lista do paciente — então a regra é: tinha aqui, não veio mais em uma
        // resposta que trouxe os eventos do paciente => excluido_externo.
        const excluidosDetectados = [];

        for (const extPatient of pacientesExternos) {
            try {
                // ============================================================
                // FILTRO DE NAVEGAÇÃO ONCOLÓGICA EXCLUSIVA (RIGOROSO)
                // ============================================================
                const hasTreatmentType4 = extPatient.treatmentTypes &&
                    Array.isArray(extPatient.treatmentTypes) &&
                    extPatient.treatmentTypes.some(t => String(t.id) === '4');
        
                const eventosValidos = (extPatient.events && Array.isArray(extPatient.events)
                    ? extPatient.events.filter(e =>
                        String(e.eventtype_id) === '2' &&
                        String(e.medicament_received) === '1' &&
                        e.medicament &&
                        String(e.medicament.treatment_types_id) === '4'
                    )
                    : []
                ).sort((a, b) => Number(a.id) - Number(b.id));

                const isFundacaoLibertas = extPatient.company &&
                    extPatient.company.name &&
                    String(extPatient.company.name).trim().toUpperCase() === 'FUNDAÇÃO LIBERTAS';

                if (!hasTreatmentType4 || eventosValidos.length === 0 || isFundacaoLibertas) {
                    console.log(`[SYNC] Ignorado: ${extPatient.name} (Motivo: Filtro não atendido ou operadora bloqueada)`);
                    continue;
                }

                console.log(`[SYNC] ⏳ Processando paciente: ${extPatient.name}...`);

                // ==========================================
                // PASSO 1: SINCRONIZAR A OPERADORA
                // ==========================================
                let operadora = null;
                if (extPatient.company) {
                    const nameOperadora = extPatient.company.name === 'CLÍNICA DE INFUSÃO COMPARTILHADA'
                        ? 'CICFARMA'
                        : extPatient.company.name;

                    if (extPatient.company.id !== undefined && extPatient.company.id !== null) {
                        operadora = await Operadora.findOne({ where: { external_id: extPatient.company.id } });
                    }

                    if (operadora && nameOperadora) {
                        await operadora.update({ nome: nameOperadora });
                    } else if (!operadora && nameOperadora) {
                        operadora = await Operadora.findOne({ where: { nome: nameOperadora } });
                        if (operadora) {
                            await operadora.update({ external_id: extPatient.company.id || null });
                        } else {
                            operadora = await Operadora.create({
                                external_id: extPatient.company.id || null,
                                nome: nameOperadora,
                                cnpj: '00000000000000',
                                telefone: '00000000000',
                                email: [],
                                is_active: true
                            });
                        }
                    }
                }

                // ==========================================
                // PASSO 2: PREPARAR OS DADOS DO PACIENTE
                // ==========================================
                const partesNome = extPatient.name ? extPatient.name.trim().split(' ') : ['Sem', 'Nome'];
                const primeiroNome = partesNome.shift();
                const restoSobrenome = partesNome.join(' ');
                const cpfLimpo = extPatient.cpf ? String(extPatient.cpf).replace(/\D/g, '') : null;

                const dadosPaciente = {
                    external_id: extPatient.id || null,
                    matricula: extPatient.matriculation || null,
                    nome: primeiroNome.toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    sobrenome: restoSobrenome.toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    cpf: cpfLimpo,
                    data_nascimento: extPatient.dateage || null,
                    sexo: extPatient.gender || 'nao definido',
                    celular: formatarCelularWhatsapp(extPatient.cellphone || extPatient.phone),
                    telefone: String(extPatient.phone || '').replace(/\D/g, ''),
                    cep: String(extPatient.zipcode || '').replace(/\D/g, ''),
                    logradouro: extPatient.address || 'N/A',
                    numero: extPatient.number || 'S/N',
                    complemento: extPatient.complement ? extPatient.complement.trim() : null,
                    bairro: extPatient.district || 'N/A',
                    cidade: extPatient.city || 'N/A',
                    estado: extPatient.state || 'N/A',
                    possui_cuidador: !!extPatient.responsible,
                    nome_cuidador: extPatient.responsible || null,
                    contato_cuidador: extPatient.phone_responsible ? formatarCelularWhatsapp(extPatient.phone_responsible) : null,
                    operadora_id: operadora ? operadora.id : null,
                    is_active: String(extPatient.status) === '0',
                    is_new_user: true
                };

                let paciente = null;
                if (dadosPaciente.external_id) {
                    paciente = await Pacientes.findOne({ where: { external_id: dadosPaciente.external_id } });
                }
                if (!paciente && dadosPaciente.cpf) {
                    paciente = await Pacientes.findOne({ where: { cpf: dadosPaciente.cpf } });
                }

                // 👇 NOVO: mesma proteção aplicada aos medicamentos — "celular" e
                // "cpf" são obrigatórios na tabela local. Preserva o dado local
                // válido se o sistema de origem mandar vazio dessa vez; se não
                // houver nada pra usar (paciente novo), interrompe com uma
                // mensagem clara (nome + ID externo do paciente) em vez do erro
                // cru do banco.
                if (!dadosPaciente.celular && paciente?.celular) dadosPaciente.celular = paciente.celular;
                if (!dadosPaciente.cpf && paciente?.cpf) dadosPaciente.cpf = paciente.cpf;

                const camposFaltandoPaciente = [];
                if (!dadosPaciente.celular) camposFaltandoPaciente.push('celular/telefone de contato');
                if (!dadosPaciente.cpf) camposFaltandoPaciente.push('CPF');

                if (camposFaltandoPaciente.length > 0) {
                    throw new Error(
                        `Paciente "${extPatient.name || 'sem nome informado'}" (ID externo #${extPatient.id}) veio do sistema de origem sem: ${camposFaltandoPaciente.join(' e ')}. Corrija esse cadastro no sistema de origem e sincronize novamente.`
                    );
                }

                if (paciente) {
                    await paciente.update(dadosPaciente);
                    pacientesAtualizadosCount++;
                } else {
                    paciente = await Pacientes.create(dadosPaciente);
                    pacientesCriadosCount++;
                }

                // ==========================================
                // PASSO 3: SINCRONIZAR O HISTÓRICO DE EVENTOS
                // ==========================================
                // ==========================================
                // PASSO 3: SINCRONIZAR O HISTÓRICO DE EVENTOS E VINCULAR MEDICAMENTO
                // ==========================================
                for (const extEvent of eventosValidos) {
                    let extMed = extEvent.medicament;
                    let medicamentoEventoId = null;

                    if (extMed) {
                        let medicamento = null;
                        if (extMed.id) medicamento = await Medicamentos.findOne({ where: { external_id: extMed.id } });
                        if (!medicamento && extMed.tusscode) medicamento = await Medicamentos.findOne({ where: { codigo_tuss: extMed.tusscode } });

                        let tipoDosagemFormatado = extMed.measurement ? String(extMed.measurement).toUpperCase().trim() : null;
                        const dosagensPermitidas = ['MG', 'G', 'MCG', 'UI', 'ML', 'MG/ML'];
                        if (tipoDosagemFormatado && !dosagensPermitidas.includes(tipoDosagemFormatado)) tipoDosagemFormatado = null;

                        let qtdCapsulaExtraida = null;
                        if (extMed.quantity) {
                            const apenasNumeros = String(extMed.quantity).replace(/\D/g, '');
                            if (apenasNumeros) qtdCapsulaExtraida = parseInt(apenasNumeros, 10);
                        }

                        const medData = {
                            external_id: extMed.id || null,
                            codigo_tuss: extMed.tusscode || null,
                            nome: extMed.name,
                            nome_comercial: extMed.commercial_name,
                            principio_ativo: extMed.active_principle,
                            qtd_capsula: qtdCapsulaExtraida,
                            dosagem: extMed.quantity ? String(extMed.quantity).trim() : null,
                            tipo_dosagem: tipoDosagemFormatado,
                            apresentacao: extMed.apresentation,
                            via_administracao: extMed.way_administration,
                            tipo_matmed: extMed.typematmed,
                            tipo_medicamento: extMed.type_medicament,
                            price: extEvent.price ? parseFloat(extEvent.price) : null,
                            fornecedor: extEvent.prices && extEvent.prices.company ? extEvent.prices.company.name : null
                        };

                        // 👇 NOVO: "nome" e "dosagem" são obrigatórios na tabela local.
                        // ⚠️ O campo "dosagem" no banco, apesar do nome, não guarda a
                        // dosagem farmacológica (isso já vem embutido no nome do
                        // medicamento, ex: "2,5 MG") — ele guarda a QUANTIDADE DE
                        // COMPRIMIDOS da caixa (campo reaproveitado, nunca renomeado).
                        // A mensagem pro operador usa o nome real do que falta, não o
                        // nome da coluna, pra não confundir com dosagem de verdade.
                        // Se o sistema externo mandar o medicamento sem algum desses
                        // dados:
                        //   - se já existe um medicamento local com o dado válido,
                        //     preserva o valor atual em vez de sobrescrever com vazio
                        //     (uma sincronização incompleta não apaga um dado bom);
                        //   - se não há nada pra usar como base (medicamento novo),
                        //     interrompe com uma mensagem clara — nome do medicamento e
                        //     ID do evento externo (pra localizar no sistema de origem)
                        //     — em vez do erro cru do banco de dados. Isso é o que
                        //     aparece no painel "quem não sincronizou" da Necessidade
                        //     de Navegação.
                        if (!medData.nome && medicamento?.nome) medData.nome = medicamento.nome;
                        if (!medData.dosagem && medicamento?.dosagem) medData.dosagem = medicamento.dosagem;

                        const camposFaltando = [];
                        if (!medData.nome) camposFaltando.push('nome do medicamento');
                        if (!medData.dosagem) camposFaltando.push('quantidade de comprimidos por caixa');

                        if (camposFaltando.length > 0) {
                            const nomeReferencia = extMed.name || extMed.commercial_name || 'sem nome informado';
                            throw new Error(
                                `Medicamento "${nomeReferencia}" (evento externo #${extEvent.id}) veio do sistema de origem sem: ${camposFaltando.join(' e ')}. Corrija esse cadastro no sistema de origem e sincronize novamente.`
                            );
                        }

                        if (medicamento) {
                            await medicamento.update(medData);
                        } else {
                            medicamento = await Medicamentos.create(medData);
                        }
                        medicamentoEventoId = medicamento.id;
                    }

                    // Upsert do Evento - Aplicando a correção de fuso horário
                    const eventoData = {
                        external_id: extEvent.id,
                        paciente_id: paciente.id,
                        medicamento_id: medicamentoEventoId,

                        data_entrega_prevista: extrairDataBrasil(extEvent.date_delivery),
                        data_entrega_real: extrairDataBrasil(extEvent.medicament_received_date),
                        data_administracao_prevista: extrairDataBrasil(extEvent.administration_date_prev),

                        qtd_caixas: extEvent.qtd_medicament ? parseInt(extEvent.qtd_medicament, 10) : 1,
                        preco: extEvent.price ? parseFloat(extEvent.price) : null,

                        // 🔥 CORREÇÃO: Respeitar o status real do recebimento
                        recebido: String(extEvent.medicament_received) === '1',
                        // 👇 NOVO: veio na resposta => existe no externo (desfaz uma exclusão detectada antes)
                        excluido_externo: false,
                        excluido_em: null
                    };

                    const eventoExistente = await EventosPaciente.findOne({ where: { external_id: extEvent.id } });
                    if (eventoExistente) {
                        if (eventoExistente.processado) {
                            const refAntes = eventoExistente.data_administracao_prevista || eventoExistente.data_entrega_prevista || eventoExistente.data_entrega_real;
                            const refDepois = eventoData.data_administracao_prevista || eventoData.data_entrega_prevista || eventoData.data_entrega_real;
                            if (refAntes && refDepois && refDepois > refAntes) {
                                reprogramadosProcessados.push(`#${extEvent.id} (paciente ${paciente.id}: ${refAntes.split('-').reverse().join('/')} → ${refDepois.split('-').reverse().join('/')})`);
                                const observacaoAnterior = eventoExistente.processamento_observacao ? `${eventoExistente.processamento_observacao} | ` : '';
                                eventoData.processamento_observacao = `${observacaoAnterior}Reprogramado no sistema externo após o processamento: referência ${refAntes} → ${refDepois} (sync de ${new Date().toISOString().split('T')[0]}).`;
                            }
                        }
                        await eventoExistente.update(eventoData);
                    } else {
                        await EventosPaciente.create(eventoData);
                    }

                    // =========================================================
                    // 🔥 CORREÇÃO: VINCULAR MEDICAMENTO AO PACIENTE
                    // =========================================================
                    if (medicamentoEventoId && paciente.medicamento_id !== medicamentoEventoId) {
                        await paciente.update({ medicamento_id: medicamentoEventoId });
                    }
                }

                // 👇 NOVO: eventos locais deste paciente que NÃO vieram na resposta
                // (qualquer tipo/status) foram excluídos no externo. Só decide
                // quando a resposta trouxe a lista de eventos do paciente — uma
                // resposta sem "events" não é prova de exclusão. Eventos já usados
                // por um ciclo também são marcados (o ciclo continua; fica o aviso).
                if (Array.isArray(extPatient.events) && extPatient.events.length > 0) {
                    const idsNoExterno = extPatient.events.map(e => parseInt(e.id, 10)).filter(n => !isNaN(n));
                    const ausentes = await EventosPaciente.findAll({
                        where: { paciente_id: paciente.id, excluido_externo: false, external_id: { [Op.notIn]: idsNoExterno } },
                        attributes: ['id', 'external_id', 'processado']
                    });
                    for (const ausente of ausentes) {
                        await ausente.update({ excluido_externo: true, excluido_em: new Date() });
                        excluidosDetectados.push(`#${ausente.external_id} (paciente ${paciente.id}${ausente.processado ? ', já usado por um ciclo' : ''})`);
                    }
                }

                successes.push({ nome: extPatient.name, cpf: extPatient.cpf });
            } catch (err) {
                console.error(`Erro ao sincronizar paciente ${extPatient.name}:`, err.message);
                errors.push({ nome: extPatient.name, cpf: extPatient.cpf, erro: err.message });
            }
        }

        // Um único evento de auditoria pra sincronização inteira, em vez de
        // um por paciente. Só grava se algo realmente aconteceu (evita
        // registrar "sincronização vazia" toda vez que o botão é clicado
        // sem nenhum dado novo pra trazer).
        if (pacientesCriadosCount > 0 || pacientesAtualizadosCount > 0) {
            await AuditService.log(
                userId, 'Sincronização', 'Pacientes', null,
                `Sincronização com o sistema externo: ${pacientesCriadosCount} paciente(s) novo(s), ${pacientesAtualizadosCount} atualizado(s)${errors.length > 0 ? `, ${errors.length} com erro` : ''}.`
            );
        }
        if (reprogramadosProcessados.length > 0) {
            await AuditService.log(
                userId, 'Sincronização', 'Eventos', null,
                `Atenção: ${reprogramadosProcessados.length} evento(s) de compra JÁ processado(s) pelo telemonitoramento tiveram a data adiada no sistema externo — possível reaproveitamento da programação para uma nova compra, que NÃO será oferecida automaticamente: ${reprogramadosProcessados.join('; ')}.`
            );
        }
        if (excluidosDetectados.length > 0) {
            await AuditService.log(
                userId, 'Sincronização', 'Eventos', null,
                `${excluidosDetectados.length} evento(s) de compra deixaram de existir no sistema externo e foram marcados como excluídos (saem das compras pendentes): ${excluidosDetectados.join('; ')}.`
            );
        }

        return { successes, errors, reprogramadosProcessados, excluidosDetectados };
    }
}

export default new PacienteSyncService();