import Sequelize, { Model } from 'sequelize';

class MonitoramentoMedicamento extends Model {
  static init(sequelize) {
    super.init({
      posologia_diaria: Sequelize.INTEGER,
      data_calculada_fim_caixa: Sequelize.DATEONLY,
      data_proximo_contato: Sequelize.DATEONLY,
      status: Sequelize.ENUM('PENDENTE', 'CONCLUIDO', 'CANCELADO'),
      qtd_informada_caixa: Sequelize.INTEGER,
      data_abertura_nova_caixa: Sequelize.DATEONLY,
      is_reacao: Sequelize.BOOLEAN,
      contato_efetivo: Sequelize.BOOLEAN,
      nivel_adesao: Sequelize.STRING,
      observacao: Sequelize.TEXT,
      data_entrega: Sequelize.DATEONLY,
      data_administracao: Sequelize.DATEONLY,
      
      data_telemonitoramento_efetivado: Sequelize.DATE,
      
      qtd_caixas: Sequelize.INTEGER,
      qtd_total_capsulas: Sequelize.INTEGER,
      evento_externo_id: Sequelize.INTEGER,

      // NOVAS COLUNAS PARA MUDANÇA DE POSOLOGIA 👇
      mudou_posologia: Sequelize.BOOLEAN,
      nova_posologia: Sequelize.INTEGER,
      data_mudanca_posologia: Sequelize.DATEONLY
      
    }, {
      sequelize,
      tableName: 'monitoramento_medicamentos',
    });
    return this;
  }

  static associate(models) {
    this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
    this.belongsTo(models.EntrevistaMedica, { foreignKey: 'entrevista_profissional_id', as: 'entrevista' });
    this.belongsTo(models.PatientEvaluation, { foreignKey: 'patient_evaluation_id', as: 'avaliacao' });
    this.belongsTo(models.Medicamentos, { foreignKey: 'medicamento_id', as: 'medicamento' });

    this.belongsTo(models.MotivoFalhaContato, { foreignKey: 'motivo_falha_contato_id', as: 'motivoFalhaContato' });
    
    this.belongsToMany(models.ReacaoAdversa, { 
      through: 'monitoramento_reacoes_adversas',
      foreignKey: 'monitoramento_id', 
      as: 'reacoesAdversas' 
    });
  }
}

export default MonitoramentoMedicamento;