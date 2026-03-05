import Sequelize, { Model } from "sequelize";

class TentativaContato extends Model {
    static init(sequelize) {
        super.init({
            sucesso: Sequelize.BOOLEAN,
        }, {
            sequelize,
            tableName: 'tentativas_contato',
        });
        return this;
    }

    static associate(models) {
        this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
        this.belongsTo(models.Medico, { foreignKey: 'medico_id', as: 'medico' });
    }
}

export default TentativaContato;