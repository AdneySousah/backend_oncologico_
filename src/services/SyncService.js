import Pacientes from '../app/models/Pacientes.js';
import Operadora from '../app/models/Operadora.js';
import Medicamentos from '../app/models/Medicamentos.js';
import AuditService from './AuditService.js';

const formatarCelularWhatsapp = (numero) => {
    if (!numero) return null;
    let limpo = String(numero).replace(/\D/g, '');
    if (limpo.length === 11 && !limpo.startsWith('55')) limpo = '55' + limpo;
    return limpo;
};

class PacienteSyncService {

   async syncPacientes(pacientesExternos, userId) {
        const successes = [];
        const errors = [];

        for (const extPatient of pacientesExternos) {
            try {
                // ============================================================
                // FILTRO DE NAVEGAÇÃO ONCOLÓGICA EXCLUSIVA (RIGOROSO)
                // ============================================================

                // 1. Verifica se o array 'treatmentTypes' do paciente possui o ID 4
                const hasTreatmentType4 = extPatient.treatmentTypes && 
                    Array.isArray(extPatient.treatmentTypes) && 
                    extPatient.treatmentTypes.some(t => String(t.id) === '4');

                // 2. Busca ESPECIFICAMENTE um evento de compra (2) com medicamento tipo 4 E recebido (1)
                const validPurchaseEvent = extPatient.events && Array.isArray(extPatient.events)
                    ? extPatient.events.find(e => 
                        String(e.eventtype_id) === '2' && 
                        String(e.medicament_received) === '1' && 
                        e.medicament && 
                        String(e.medicament.treatment_types_id) === '4'
                    )
                    : null;

                // 3. Verifica se a operadora é a FUNDAÇÃO LIBERTAS (bloqueio de sync)
                const isFundacaoLibertas = extPatient.company && 
                    extPatient.company.name && 
                    String(extPatient.company.name).trim().toUpperCase() === 'FUNDAÇÃO LIBERTAS';

                // Se não passou no filtro geral, não tem evento válido, ou a operadora bloqueada
                if (!hasTreatmentType4 || !validPurchaseEvent || isFundacaoLibertas) {
                    console.log(`[SYNC] Ignorado: ${extPatient.name} (Motivo: Filtro não atendido ou operadora Fundação Libertas)`);
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
                        operadora = await Operadora.findOne({
                            where: { external_id: extPatient.company.id }
                        });
                    }

                    if (operadora && nameOperadora) {
                        await operadora.update({ nome: nameOperadora });
                    }
                    else if (!operadora && nameOperadora) {
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
                // PASSO 2: SINCRONIZAR O MEDICAMENTO E O PREÇO
                // ==========================================
                let medicamento_id = null;
                let type_tratment_med = 4;
                
                // Pegamos o medicamento ESTRITAMENTE do evento de compra que validamos!
                let extMed = validPurchaseEvent.medicament;
                let eventPrice = validPurchaseEvent.price || null;
                
                if (extMed) {
                    let medicamento = null; 

                    if (extMed.id && type_tratment_med === 3) {
                        medicamento = await Medicamentos.findOne({ where: { external_id: extMed.id } });
                    }

                    if (!medicamento && extMed.tusscode) {
                        medicamento = await Medicamentos.findOne({ where: { codigo_tuss: extMed.tusscode } });
                    }

                    let tipoDosagemFormatado = extMed.measurement ? String(extMed.measurement).toUpperCase().trim() : null;
                    const dosagensPermitidas = ['MG', 'G', 'MCG', 'UI', 'ML', 'MG/ML'];
                    if (tipoDosagemFormatado && !dosagensPermitidas.includes(tipoDosagemFormatado)) {
                        tipoDosagemFormatado = null;
                    }

                    let qtdCapsulaExtraida = null;
                    if (extMed.dosage) {
                        const apenasNumeros = String(extMed.dosage).replace(/\D/g, '');
                        if (apenasNumeros) {
                            qtdCapsulaExtraida = parseInt(apenasNumeros, 10);
                        }
                    }

                    const medData = {
                        external_id: extMed.id || null,
                        codigo_tuss: extMed.tusscode || null,
                        nome: extMed.name,
                        nome_comercial: extMed.commercial_name,
                        principio_ativo: extMed.active_principle,
                        qtd_capsula: qtdCapsulaExtraida,
                        dosagem: extMed.dosage ? String(extMed.dosage).trim() : null,
                        tipo_dosagem: tipoDosagemFormatado,
                        apresentacao: extMed.apresentation,
                        via_administracao: extMed.way_administration,
                        tipo_matmed: extMed.typematmed,
                        tipo_medicamento: extMed.type_medicament,
                        price: eventPrice ? parseFloat(eventPrice) : null
                    };

                    if (medicamento) {
                        await medicamento.update(medData);
                    } else {
                        medicamento = await Medicamentos.create(medData);
                    }

                    medicamento_id = medicamento.id;
                }

                // ==========================================
                // PASSO 3: PREPARAR OS DADOS DO PACIENTE
                // ==========================================
                const partesNome = extPatient.name ? extPatient.name.trim().split(' ') : ['Sem', 'Nome'];
                const primeiroNome = partesNome.shift();
                const restoSobrenome = partesNome.join(' ');

                const cpfLimpo = extPatient.cpf ? String(extPatient.cpf).replace(/\D/g, '') : null;

                // Extrai a data de entrega estritamente do evento que validamos
                let dateDeliveryExtraido = validPurchaseEvent.administration_date_prev || null;
                
                // 👇 NOVO: Extrai a quantidade de caixas compradas no evento
                let qtdCaixasExtraida = validPurchaseEvent.qtd_medicament ? parseInt(validPurchaseEvent.qtd_medicament, 10) : 1;

                
                const dadosPaciente = { 
                    external_id: extPatient.id || null,
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
                    medicamento_id: medicamento_id,
                    data_entrega_medicamento: dateDeliveryExtraido,
                    
                    // 👇 NOVO: Salva a quantidade de caixas do último evento
                    qtd_caixas: qtdCaixasExtraida,

                    is_active: String(extPatient.status) === '0',
                    is_new_user: true
                };

                // ==========================================
                // PASSO 4: SALVAR NO BANCO LOCAL
                // ==========================================
                let paciente = null;

                if (dadosPaciente.external_id) {
                    paciente = await Pacientes.findOne({ where: { external_id: dadosPaciente.external_id } });
                }

                if (!paciente && dadosPaciente.cpf) {
                    paciente = await Pacientes.findOne({ where: { cpf: dadosPaciente.cpf } });
                }

                if (paciente) {
                    await paciente.update(dadosPaciente);
                    await AuditService.log(userId, 'Edição', 'Pacientes', paciente.id, `Paciente ${dadosPaciente.nome} ${dadosPaciente.sobrenome} atualizado via sincronização.`);

                } else {
                    await Pacientes.create(dadosPaciente);
                    await AuditService.log(userId, 'Criação', 'Pacientes', null, `Paciente ${dadosPaciente.nome} ${dadosPaciente.sobrenome} criado via sincronização.`);
                }

                successes.push({ nome: extPatient.name, cpf: extPatient.cpf });

            } catch (err) {
                console.error(`Erro ao sincronizar paciente ${extPatient.name}:`, err.message);
                errors.push({ nome: extPatient.name, cpf: extPatient.cpf, erro: err.message });
            }
        }

        return { successes, errors };
    }
}

export default new PacienteSyncService();