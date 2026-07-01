import Sequelize, { Model } from 'sequelize';
import Pacientes from './Pacientes.js'; // Importação direta como garantia

class PacienteTermoAnexo extends Model {
    static init(sequelize) {
        super.init({
            arquivo_path: Sequelize.STRING,
            nome_original: Sequelize.STRING,
            url: {
                type: Sequelize.VIRTUAL,
                get() {
                    return `${process.env.APP_URL || 'http://localhost:3002'}/files/${this.arquivo_path}`;
                }
            }
        }, {
            sequelize,
            tableName: 'paciente_termos_anexos',
        });
        return this;
    }

    static associate(models) {
        // 👇 ALIAS AJUSTADO PARA O SINGULAR ('paciente') E FALLBACK ADICIONADO
        this.belongsTo(models.Pacientes || Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
    }
}

export default PacienteTermoAnexo;